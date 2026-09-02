import { createHash } from "node:crypto";
import type {
    CodeChange,
    DiffChunk,
    RawCodeChange,
    ReviewChangeInput,
    SourceRange,
} from "../../../domain/review/model/code-change.js";
import {
    isSensitiveFile,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const toSourceRange = (start: string, count: string | undefined): SourceRange | undefined => {
    const numericStart = Number(start);
    const numericCount = count === undefined ? 1 : Number(count);

    return numericCount === 0
        ? undefined
        : { startLine: numericStart, endLine: numericStart + numericCount - 1 };
};

const createChunkId = (
    path: string,
    oldRange: SourceRange | undefined,
    newRange: SourceRange | undefined,
    content: string,
): string => createHash("sha256")
    .update(JSON.stringify({ path, oldRange, newRange, content }))
    .digest("hex")
    .slice(0, 24);

const createDiffChunks = (diff: string): DiffChunk[] => {
    const chunks: DiffChunk[] = [];
    let path: string | undefined;
    let oldPath: string | undefined;
    let oldRange: SourceRange | undefined;
    let newRange: SourceRange | undefined;
    let lines: string[] = [];

    const flush = (): void => {
        if (path === undefined || lines.length === 0) {
            lines = [];
            return;
        }

        const content = lines.join("\n");
        chunks.push({
            id: createChunkId(path, oldRange, newRange, content),
            path,
            ...(newRange === undefined ? {} : { newRange }),
            ...(oldRange === undefined ? {} : { oldRange }),
            content,
        });
        lines = [];
    };

    for (const line of diff.split("\n")) {
        if (line.startsWith("diff --git ")) {
            flush();
            path = undefined;
            oldPath = undefined;
            oldRange = undefined;
            newRange = undefined;
            continue;
        }

        if (line.startsWith("--- a/")) {
            oldPath = line.slice("--- a/".length);
            continue;
        }

        if (line.startsWith("+++ b/")) {
            path = line.slice("+++ b/".length);
            continue;
        }

        if (line === "+++ /dev/null") {
            path = oldPath;
            continue;
        }

        const hunk = HUNK_HEADER.exec(line);
        if (hunk !== null) {
            flush();
            oldRange = toSourceRange(hunk[1] ?? "0", hunk[2]);
            newRange = toSourceRange(hunk[3] ?? "0", hunk[4]);
            lines = [line];
            continue;
        }

        if (lines.length > 0) {
            lines.push(line);
        }
    }

    flush();
    return chunks;
};

/**
 * 将原始已提交变更投影为可安全离开本地进程的评审输入。
 *
 * 敏感文件在此边界被移除，其他 diff 在分块前完成值脱敏。调用方不得保留
 * 原始输入的引用，也不得将其传递给远程分析器或任何输出端口。
 */
export const createSanitizedCodeChange = (rawCodeChange: RawCodeChange): CodeChange => {
    const safeFileChanges = rawCodeChange.fileChanges.filter(
        ({ file }) => !isSensitiveFile(file),
    );
    const rawSafeDiff = safeFileChanges.map(({ diff }) => diff).join("");
    const redactedDiff = redactSensitiveValues(rawSafeDiff);

    return {
        diff: redactedDiff.content,
        files: safeFileChanges.map(({ file }) => file),
        chunks: createDiffChunks(redactedDiff.content),
        excludedFileCount: rawCodeChange.fileChanges.length - safeFileChanges.length,
        redactedValueCount: redactedDiff.redactedValueCount,
    };
};

/** 创建受控的原始/安全输入对，供本地调度器按分析器能力分发。 */
export const createReviewChangeInput = (rawCodeChange: RawCodeChange): ReviewChangeInput => ({
    rawCodeChange,
    codeChange: createSanitizedCodeChange(rawCodeChange),
});
