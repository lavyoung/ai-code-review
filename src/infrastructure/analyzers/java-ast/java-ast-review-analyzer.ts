import {parser} from "@lezer/java";
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

const isJavaSource = (path: string): boolean => /\.java$/iu.test(path);

/** 只返回已提交 diff 的新增 Java 源码行；原始内容不会离开本地分析器。 */
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

/**
 * 使用 Java 语法解析器验证新增语句，再识别直接的 `Runtime.getRuntime().exec(...)` 调用。
 *
 * 此规则只证明语法形状，不能证明 `Runtime` 的运行时类型，因此结果保持 advisory，不能
 * 直接触发质量门禁。
 */
const containsDirectRuntimeExecCall = (source: string): boolean => {
    const wrappedSource = `class ReviewTarget {
    void review() throws Exception {
        ${source}
    }
}`;
    const cursor = parser.parse(wrappedSource).cursor();
    do {
        if (cursor.name === "⚠") {
            return false;
        }
        if (cursor.name === "MethodInvocation"
            && wrappedSource.slice(cursor.from, cursor.to).replaceAll(/\s/gu, "")
                .startsWith("Runtime.getRuntime().exec(")) {
            return true;
        }
    } while (cursor.next());

    return false;
};

/**
 * 对已提交 Java diff 执行受限语法检查，不读取工作区、不执行 Maven、Gradle 或 Java 代码。
 *
 * 发现始终锚定到新增行，并保持为 advisory；语义性 Java 缺陷应由可信的编译器、SARIF 或
 * 字节码分析报告提供证据后再进入质量门禁。
 */
export class JavaAstReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {kind: "ast", id: "java-ast"};

    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    };

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        if (!isTrustedLocalRequest(request)) {
            throw new Error("Java AST analysis requires trusted raw local input.");
        }

        const findings = request.rawCodeChange.fileChanges.flatMap((fileChange): ReviewCandidate[] => {
            if (isSensitiveFile(fileChange.file) || !isJavaSource(fileChange.file.path)) {
                return [];
            }
            return findAddedLines(fileChange.diff).flatMap((addedLine) => {
                if (!containsDirectRuntimeExecCall(addedLine.content)) {
                    return [];
                }
                const located = findAddedLineEvidence(request.codeChange, fileChange.file.path, addedLine.line);
                if (located === undefined) {
                    return [];
                }
                return [{
                    severity: "high",
                    title: "Runtime command execution introduced",
                    description: "A direct Runtime.getRuntime().exec call was added to Java code.",
                    suggestion: "Validate command construction and prefer a constrained process execution boundary.",
                    category: "security",
                    file: fileChange.file.path,
                    line: addedLine.line,
                    chunkId: located.chunk.id,
                    evidence: located.evidence,
                }];
            });
        });

        return {
            summary: `Java AST completed with ${findings.length} advisory candidate(s).`,
            findings,
        };
    }
}
