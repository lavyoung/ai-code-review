import type { SummaryReviewComment } from "../../../domain/review/model/review-comment.js";

/**
 * 生成带稳定隐藏标识的 Markdown 摘要评论。
 *
 * Markdown 内容必须已在接口层完成脱敏，避免敏感信息进入任何平台评论。
 */
export const createSummaryReviewComment = (
    reviewId: string,
    markdown: string,
    revision?: string,
    runId?: string,
): SummaryReviewComment => {
    const normalizedRevision = revision?.trim();
    const normalizedRunId = runId?.trim();
    if (normalizedRevision !== undefined
        && (normalizedRevision.length === 0 || normalizedRevision.includes("\n") || normalizedRevision.includes("\r") || normalizedRevision.includes("-->"))) {
        throw new Error("Review comment revision is invalid.");
    }
    if (normalizedRunId !== undefined
        && (normalizedRunId.length === 0 || normalizedRunId.includes("\n") || normalizedRunId.includes("\r") || normalizedRunId.includes("-->"))) {
        throw new Error("Review comment run identifier is invalid.");
    }

    return {
        type: "summary",
        reviewId,
        ...(normalizedRevision === undefined ? {} : { revision: normalizedRevision }),
        ...(normalizedRunId === undefined ? {} : { runId: normalizedRunId }),
        body: `<!-- ai-code-review:review-id=${reviewId} -->${normalizedRevision === undefined ? "" : `\n<!-- ai-code-review:revision=${normalizedRevision} -->`}${normalizedRunId === undefined ? "" : `\n<!-- ai-code-review:run=${normalizedRunId} -->`}\n\n${markdown}`,
    };
};
