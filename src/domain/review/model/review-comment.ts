/**
 * 可由平台适配器幂等更新的摘要评论。
 */
export interface SummaryReviewComment {
    type: "summary";
    reviewId: string;
    body: string;
}

const containsUnsafeMarkerValue = (value: string): boolean =>
    value.includes("\n") || value.includes("\r") || value.includes("-->");

/**
 * 为同一平台变更生成稳定的评论标识，用于查询并更新已有摘要评论。
 *
 * @param provider 代码托管平台标识。
 * @param repository 平台内的仓库标识。
 * @param changeId MR 或 PR 编号。
 * @returns 可嵌入 Markdown HTML 注释的稳定标识。
 * @throws 当任意标识为空或会破坏 HTML 注释时抛出错误。
 */
export const createReviewCommentId = (
    provider: string,
    repository: string,
    changeId: string,
): string => {
    const values = [provider, repository, changeId].map((value) => value.trim());

    if (values.some((value) => value.length === 0 || containsUnsafeMarkerValue(value))) {
        throw new Error("Review comment identifier is invalid.");
    }

    return values.join(":");
};
