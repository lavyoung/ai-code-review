import * as ts from "@typescript/typescript6";
import type {RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {ReviewCandidate} from "../../../domain/review/model/review-candidate.js";
import {findAddedLineEvidence} from "../../../domain/review/policy/find-added-line-evidence.js";
import {isSensitiveFile} from "../../../domain/review/policy/sensitive-content-policy.js";
import type {
    AnalysisRequest,
    AnalyzerIdentity,
    ReviewAnalyzer,
} from "../../../application/review/ports/review-analyzer-port.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface AddedLine {
    line: number;
    content: string;
}

const isTrustedLocalRequest = (request: AnalysisRequest): request is AnalysisRequest & {
    rawCodeChange: RawCodeChange;
} => "rawCodeChange" in request;

const isTypeScriptSource = (path: string): boolean => /\.tsx?$/iu.test(path) && !/\.d\.ts$/iu.test(path);

/** 仅提取已提交 diff 的新增源代码行，绝不将其返回到适配器外部。 */
const findAddedLines = (diff: string): AddedLine[] => {
    const addedLines: AddedLine[] = [];
    let newLineNumber: number | undefined;
    for (const diffLine of diff.split("\n")) {
        const hunk = HUNK_HEADER.exec(diffLine);
        if (hunk !== null) {
            newLineNumber = Number(hunk[1]);
            continue;
        }
        if (newLineNumber === undefined || diffLine.startsWith("\\ No newline")) {
            continue;
        }
        if (diffLine.startsWith("+") && !diffLine.startsWith("+++")) {
            addedLines.push({line: newLineNumber, content: diffLine.slice(1)});
            newLineNumber += 1;
            continue;
        }
        if (diffLine.startsWith(" ")) {
            newLineNumber += 1;
        }
    }
    return addedLines;
};

/** 仅接受单行中可由 TypeScript AST 完整识别的直接 `eval(...)` 调用。 */
const containsDirectEvalCall = (path: string, source: string): boolean => {
    const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    let found = false;
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === "eval") {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
};

/**
 * 对新增 TypeScript 行执行受限 AST 规则检查。
 *
 * 该分析器只识别语法树可直接证明的 `eval(...)` 调用；不读取工作区文件，因而
 * 不会将未提交改动混入评审范围。原始 diff 仅在本地用于解析，输出仍由安全 diff 锚定。
 */
export class TypeScriptAstReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {kind: "ast", id: "typescript-ast"};

    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    };

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        if (!isTrustedLocalRequest(request)) {
            throw new Error("TypeScript AST analysis requires trusted raw local input.");
        }

        const findings = request.rawCodeChange.fileChanges.flatMap((fileChange): ReviewCandidate[] => {
            if (isSensitiveFile(fileChange.file) || !isTypeScriptSource(fileChange.file.path)) {
                return [];
            }
            return findAddedLines(fileChange.diff).flatMap((addedLine) => {
                if (!containsDirectEvalCall(fileChange.file.path, addedLine.content)) {
                    return [];
                }
                const located = findAddedLineEvidence(request.codeChange, fileChange.file.path, addedLine.line);
                if (located === undefined) {
                    return [];
                }
                return [{
                    severity: "high",
                    title: "Unsafe eval call",
                    description: "A direct eval call was added to TypeScript code.",
                    suggestion: "Replace eval with a constrained parser or an explicit implementation.",
                    category: "security",
                    file: fileChange.file.path,
                    line: addedLine.line,
                    chunkId: located.chunk.id,
                    evidence: located.evidence,
                }];
            });
        });

        return {
            summary: `TypeScript AST completed with ${findings.length} verified candidate(s).`,
            findings,
        };
    }
}
