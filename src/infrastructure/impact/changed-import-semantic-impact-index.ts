import {createHash} from "node:crypto";
import type {CodeChange, RawCodeChange} from "../../domain/review/model/code-change.js";
import type {StaticImpactRelation} from "../../domain/impact/model/impact-package.js";
import {findAddedLineEvidence} from "../../domain/review/policy/find-added-line-evidence.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../domain/review/policy/sensitive-content-policy.js";
import type {
    SemanticImpactIndexPort,
    SemanticImpactIndexResult,
} from "../../application/review/ports/semantic-impact-index-port.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const typeScriptImport = /^\+\s*(?:import|export)\s+(?:.+?\s+from\s+)?["']([^"']+)["']/u;
const commonJsRequire = /^\+.*?require\(\s*["']([^"']+)["']\s*\)/u;
const javaImport = /^\+\s*import\s+(?:static\s+)?([A-Za-z_$][\w.$]*(?:\.\*)?);/u;
const testPath = /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu;

interface AddedLine {
    line: number;
    content: string;
}

const findAddedLines = (diff: string): AddedLine[] => {
    const lines: AddedLine[] = [];
    let newLine: number | undefined;
    for (const line of diff.split("\n")) {
        const header = HUNK_HEADER.exec(line);
        if (header !== null) {
            newLine = Number(header[1]);
            continue;
        }
        if (newLine === undefined || line.startsWith("\\ No newline")) {
            continue;
        }
        if (line.startsWith("+") && !line.startsWith("+++")) {
            lines.push({line: newLine, content: line});
            newLine += 1;
            continue;
        }
        if (line.startsWith(" ")) {
            newLine += 1;
        }
    }
    return lines;
};

const relationId = (chunkId: string, target: string): string =>
    `relation:${createHash("sha256").update(`${chunkId}:${target}`).digest("hex").slice(0, 16)}`;

const toSafeTarget = (target: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(target).content).slice(0, 256);

/**
 * 从新增 TypeScript/Java import、CommonJS require 及已锚定源码变更中提取静态关系。
 *
 * 动态 import、反射和不受支持语言不会被假定为无影响，而是作为限制返回。
 */
export class ChangedImportSemanticImpactIndex implements SemanticImpactIndexPort {
    public async analyze(
        rawCodeChange: RawCodeChange,
        codeChange: CodeChange,
        signal: AbortSignal,
    ): Promise<SemanticImpactIndexResult> {
        if (signal.aborted) {
            throw signal.reason;
        }

        const relations: StaticImpactRelation[] = [];
        let dynamicDependencySeen = false;
        let unsupportedLanguageSeen = false;
        let unanchoredSourceChangeSeen = false;
        for (const fileChange of rawCodeChange.fileChanges) {
            if (isSensitiveFile(fileChange.file)) {
                continue;
            }
            const path = fileChange.file.path;
            const language = /\.(?:[cm]?[jt]sx?)$/iu.test(path)
                ? "typescript"
                : /\.java$/iu.test(path)
                    ? "java"
                    : undefined;
            if (language === undefined) {
                unsupportedLanguageSeen = true;
                continue;
            }
            const addedLines = findAddedLines(fileChange.diff);
            const firstAddedLine = addedLines[0];
            if (!testPath.test(path)) {
                if (firstAddedLine === undefined) {
                    unanchoredSourceChangeSeen = true;
                } else {
                    const located = findAddedLineEvidence(codeChange, path, firstAddedLine.line);
                    if (located === undefined) {
                        unanchoredSourceChangeSeen = true;
                    } else {
                        const target = language === "typescript" ? "changed-typescript-source" : "changed-java-source";
                        relations.push({
                            id: relationId(located.chunk.id, target),
                            changeAnchorId: located.chunk.id,
                            sourcePath: located.chunk.path,
                            sourceLine: firstAddedLine.line,
                            target,
                            kind: language === "typescript" ? "typescript-source-change" : "java-source-change",
                            completeness: "partial",
                        });
                    }
                }
            }
            for (const addedLine of addedLines) {
                if (language === "typescript" && /\+.*?\bimport\s*\(/u.test(addedLine.content)) {
                    dynamicDependencySeen = true;
                }
                const target = language === "typescript"
                    ? typeScriptImport.exec(addedLine.content)?.[1] ?? commonJsRequire.exec(addedLine.content)?.[1]
                    : javaImport.exec(addedLine.content)?.[1];
                if (target === undefined) {
                    continue;
                }
                const located = findAddedLineEvidence(codeChange, path, addedLine.line);
                if (located === undefined) {
                    continue;
                }
                const safeTarget = toSafeTarget(target);
                relations.push({
                    id: relationId(located.chunk.id, safeTarget),
                    changeAnchorId: located.chunk.id,
                    sourcePath: path,
                    sourceLine: addedLine.line,
                    target: safeTarget,
                    kind: language === "typescript" ? "module-import" : "java-import",
                    completeness: "partial",
                });
            }
        }

        return {
            relations,
            limitations: [
                ...(dynamicDependencySeen ? ["dynamic-dependency-unavailable" as const] : []),
                ...(unsupportedLanguageSeen ? ["unsupported-language" as const] : []),
                ...(unanchoredSourceChangeSeen ? ["source-change-unanchored" as const] : []),
            ],
        };
    }
}
