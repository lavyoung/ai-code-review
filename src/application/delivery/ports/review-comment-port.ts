import type { SummaryReviewComment } from "../../../domain/review/model/review-comment.js";

/**
 * 代码托管平台摘要评论的幂等发布端口。
 *
 * 适配器负责按 reviewId 查找既有评论并更新；不存在时才创建。
 */
export interface ReviewCommentPort {
    upsertSummary(comment: SummaryReviewComment): Promise<void>;
}
