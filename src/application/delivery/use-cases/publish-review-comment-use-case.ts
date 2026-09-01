import type { SummaryReviewComment } from "../../../domain/review/model/review-comment.js";
import type { ReviewCommentPort } from "../ports/review-comment-port.js";

/** 可安全出现在 CI 日志中的摘要评论发布结果。 */
export interface ReviewCommentPublication {
    status: "delivered" | "failed" | "skipped";
}

/**
 * 调用平台适配器创建或更新摘要评论。
 *
 * 失败原因不在此处向上暴露，防止平台 Token、请求地址或评论内容进入日志。
 */
export const publishReviewCommentUseCase = async (
    comment: SummaryReviewComment,
    publisher: ReviewCommentPort,
): Promise<ReviewCommentPublication> => {
    try {
        const result = await publisher.upsertSummary(comment);
        return { status: result === "skipped" ? "skipped" : "delivered" };
    } catch {
        return { status: "failed" };
    }
};
