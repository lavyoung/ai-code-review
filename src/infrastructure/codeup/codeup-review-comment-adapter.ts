import type { ReviewCommentPort } from "../../application/ports/review-comment-port.js";
import type { SummaryReviewComment } from "../../domain/review/review-comment.js";

/**
 * 调用 CodeUp 合并请求评论 API 所需的运行时上下文。
 *
 * accessToken 只能由 CI Secret 或环境变量注入，调用方不得记录它或其所属请求地址。
 */
export interface CodeUpReviewCommentConfiguration {
    apiBaseUrl: string;
    accessToken: string;
    repositoryId: string;
    changeRequestId: string;
    patchSetBizId: string;
    organizationId?: string;
}

interface CodeUpComment {
    comment_biz_id?: unknown;
    comment_type?: unknown;
    content?: unknown;
}

const toPathSegment = (value: string): string => encodeURIComponent(value);

/** CodeUp MR 全局评论的基础设施适配器。 */
export class CodeUpReviewCommentAdapter implements ReviewCommentPort {
    public constructor(
        private readonly configuration: CodeUpReviewCommentConfiguration,
        private readonly send: typeof fetch = fetch,
    ) {}

    /**
     * 根据固定标识更新已有全局评论；找不到时创建新的已发布全局评论。
     *
     * @throws CodeUp 请求或响应无效时抛出不含 Token、地址或评论内容的错误。
     */
    public async upsertSummary(comment: SummaryReviewComment): Promise<void> {
        const existingCommentId = await this.findCommentId(comment.reviewId);

        if (existingCommentId === undefined) {
            await this.createComment(comment.body);
            return;
        }

        await this.updateComment(existingCommentId, comment.body);
    }

    private get changeRequestPath(): string {
        const { repositoryId, changeRequestId, organizationId } = this.configuration;
        const root = organizationId === undefined
            ? "/oapi/v1/codeup/repositories"
            : `/oapi/v1/codeup/organizations/${toPathSegment(organizationId)}/repositories`;

        return `${root}/${toPathSegment(repositoryId)}/changeRequests/${toPathSegment(changeRequestId)}`;
    }

    private async findCommentId(reviewId: string): Promise<string | undefined> {
        const response = await this.request(`${this.changeRequestPath}/comments/list`, {
            method: "POST",
            body: JSON.stringify({
                comment_type: "GLOBAL_COMMENT",
                state: "OPENED",
            }),
        });
        const payload = await this.readJson(response);

        if (!Array.isArray(payload)) {
            throw new Error("CodeUp comment list response was invalid.");
        }

        const marker = `<!-- ai-code-review:review-id=${reviewId} -->`;
        const existing = payload.find((value): value is CodeUpComment => {
            if (typeof value !== "object" || value === null) {
                return false;
            }

            const candidate = value as CodeUpComment;
            return candidate.comment_type === "GLOBAL_COMMENT"
                && typeof candidate.content === "string"
                && candidate.content.includes(marker);
        });

        if (existing === undefined) {
            return undefined;
        }

        if (typeof existing.comment_biz_id !== "string" || existing.comment_biz_id.length === 0) {
            throw new Error("CodeUp comment identifier was invalid.");
        }

        return existing.comment_biz_id;
    }

    private async createComment(content: string): Promise<void> {
        await this.request(`${this.changeRequestPath}/comments`, {
            method: "POST",
            body: JSON.stringify({
                comment_type: "GLOBAL_COMMENT",
                content,
                draft: false,
                patchset_biz_id: this.configuration.patchSetBizId,
                resolved: false,
            }),
        });
    }

    private async updateComment(commentId: string, content: string): Promise<void> {
        await this.request(`${this.changeRequestPath}/comments/${toPathSegment(commentId)}`, {
            method: "PUT",
            body: JSON.stringify({ content, resolved: false }),
        });
    }

    private async request(path: string, init: RequestInit): Promise<Response> {
        const response = await this.send(new URL(path, this.configuration.apiBaseUrl).toString(), {
            ...init,
            headers: {
                "Content-Type": "application/json",
                "x-yunxiao-token": this.configuration.accessToken,
            },
        });

        if (!response.ok) {
            throw new Error("CodeUp review comment request failed.");
        }

        return response;
    }

    private async readJson(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            throw new Error("CodeUp review comment response was invalid.");
        }
    }
}
