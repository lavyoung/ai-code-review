import type { SummaryReviewComment } from "../../../domain/review/model/review-comment.js";

/**
 * 生成带稳定隐藏标识的 Markdown 摘要评论。
 *
 * Markdown 内容必须已在接口层完成脱敏，避免敏感信息进入任何平台评论。
 */
export const createSummaryReviewComment = (
    reviewId: string,
    markdown: string,
): SummaryReviewComment => ({
    type: "summary",
    reviewId,
    body: `<!-- ai-code-review:review-id=${reviewId} -->\n\n${markdown}`,
});
