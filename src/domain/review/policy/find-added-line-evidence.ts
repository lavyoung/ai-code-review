import type { CodeChange, DiffChunk } from "../model/code-change.js";

/** 已脱敏 diff 中新增行可追溯的安全证据。 */
export interface AddedLineEvidence {
    chunk: DiffChunk;
    evidence: string;
}

const findEvidenceInChunk = (content: string, targetLine: number): string | undefined => {
    let currentLine: number | undefined;

    for (const line of content.split("\n")) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk !== null) {
            currentLine = Number(hunk[1]);
            continue;
        }

        if (currentLine === undefined || line.startsWith("-")) {
            continue;
        }

        if (line.startsWith("+") && currentLine === targetLine) {
            return line;
        }

        if (line.startsWith("+") || line.startsWith(" ")) {
            currentLine += 1;
        }
    }

    return undefined;
};

/** 只定位真正新增的行，避免把 diff 上下文中的历史问题归因于本次提交。 */
export const findAddedLineEvidence = (
    codeChange: CodeChange,
    path: string,
    line: number,
): AddedLineEvidence | undefined => codeChange.chunks
    .filter((chunk) => chunk.path === path)
    .map((chunk) => ({ chunk, evidence: findEvidenceInChunk(chunk.content, line) }))
    .find((candidate): candidate is AddedLineEvidence => candidate.evidence !== undefined);
