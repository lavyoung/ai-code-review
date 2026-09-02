import type { CodeChange, DiffChunk } from "../../../domain/review/model/code-change.js";

const truncateChunk = (chunk: DiffChunk, maxSerializedLength: number): DiffChunk | undefined => {
    const emptyChunk = { ...chunk, content: "" };
    if (JSON.stringify([emptyChunk]).length > maxSerializedLength) {
        return undefined;
    }

    let lowerBound = 0;
    let upperBound = chunk.content.length;
    while (lowerBound < upperBound) {
        const candidateLength = Math.ceil((lowerBound + upperBound) / 2);
        if (JSON.stringify([{ ...chunk, content: chunk.content.slice(0, candidateLength) }]).length
            <= maxSerializedLength) {
            lowerBound = candidateLength;
        } else {
            upperBound = candidateLength - 1;
        }
    }

    const content = chunk.content.slice(0, lowerBound);
    const lastLineBreak = content.lastIndexOf("\n");
    return {
        ...chunk,
        content: lastLineBreak > 0 ? content.slice(0, lastLineBreak) : content,
    };
};

/**
 * 为远程模型创建有界的安全 diff 输入。
 *
 * 仅保留按原始 diff 顺序排列的前缀分块；本地分析器始终接收完整的本地输入。
 */
export const boundSanitizedModelInput = (
    codeChange: CodeChange,
    maxSerializedLength: number,
): CodeChange => {
    const chunks: DiffChunk[] = [];
    for (const chunk of codeChange.chunks) {
        const candidate = [...chunks, chunk];
        if (JSON.stringify(candidate).length <= maxSerializedLength) {
            chunks.push(chunk);
            continue;
        }

        if (chunks.length === 0) {
            const truncatedChunk = truncateChunk(chunk, maxSerializedLength);
            if (truncatedChunk !== undefined) {
                chunks.push(truncatedChunk);
            }
        }
        break;
    }

    const paths = new Set(chunks.map((chunk) => chunk.path));
    return {
        ...codeChange,
        diff: chunks.map((chunk) => chunk.content).join("\n"),
        files: codeChange.files.filter((file) => paths.has(file.path)),
        chunks,
    };
};
