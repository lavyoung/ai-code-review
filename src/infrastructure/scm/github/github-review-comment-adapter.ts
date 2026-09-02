import type { ReviewCommentPort } from "../../../application/delivery/ports/review-comment-port.js";
import type { SummaryReviewComment } from "../../../domain/review/model/review-comment.js";

/**
 * 调用 GitHub Pull Request 摘要评论 API 的运行时上下文。
 *
 * accessToken 只能由 CI Secret 或环境变量注入，apiBaseUrl 可指向 GitHub Enterprise API。
 */
export interface GitHubReviewCommentConfiguration {
    owner: string;
    repository: string;
    pullRequestNumber: string;
    accessToken: string;
    apiBaseUrl?: string;
}

interface GitHubIssueComment {
    id?: unknown;
    body?: unknown;
}

interface GitHubPullRequest {
    head?: { sha?: unknown };
}

const GITHUB_API_VERSION = "2026-03-10";
const PAGE_SIZE = 100;

const toPathSegment = (value: string): string => encodeURIComponent(value);

/** GitHub PR 时间线摘要评论的基础设施适配器。 */
export class GitHubReviewCommentAdapter implements ReviewCommentPort {
    public constructor(
        private readonly configuration: GitHubReviewCommentConfiguration,
        private readonly send: typeof fetch = fetch,
    ) {}

    /**
     * 在 PR 时间线中按固定标识更新评论；找不到时创建一条新的摘要评论。
     *
     * @throws GitHub 请求或响应无效时抛出不含 Token、地址或评论内容的错误。
     */
    public async upsertSummary(comment: SummaryReviewComment): Promise<"delivered" | "skipped"> {
        if (comment.revision !== undefined && !await this.isCurrentRevision(comment.revision)) {
            return "skipped";
        }
        const existingCommentId = await this.findCommentId(comment.reviewId);

        if (existingCommentId === undefined) {
            await this.createComment(comment.body);
            return "delivered";
        }

        await this.updateComment(existingCommentId, comment.body);
        return "delivered";
    }

    private get pullRequestPath(): string {
        const { owner, repository, pullRequestNumber } = this.configuration;
        return `/repos/${toPathSegment(owner)}/${toPathSegment(repository)}/issues/${toPathSegment(pullRequestNumber)}`;
    }

    private get pullRequestApiPath(): string {
        const { owner, repository, pullRequestNumber } = this.configuration;
        return `/repos/${toPathSegment(owner)}/${toPathSegment(repository)}/pulls/${toPathSegment(pullRequestNumber)}`;
    }

    private async findCommentId(reviewId: string): Promise<string | undefined> {
        const marker = `<!-- ai-code-review:review-id=${reviewId} -->`;

        for (let page = 1; ; page += 1) {
            const response = await this.request(
                `${this.pullRequestPath}/comments?per_page=${PAGE_SIZE}&page=${page}`,
                { method: "GET" },
            );
            const payload = await this.readJson(response);

            if (!Array.isArray(payload)) {
                throw new Error("GitHub comment list response was invalid.");
            }

            const existing = payload.find((value): value is GitHubIssueComment => {
                if (typeof value !== "object" || value === null) {
                    return false;
                }

                const candidate = value as GitHubIssueComment;
                return typeof candidate.body === "string" && candidate.body.includes(marker);
            });

            if (existing !== undefined) {
                if ((typeof existing.id !== "number" && typeof existing.id !== "string")
                    || String(existing.id).length === 0) {
                    throw new Error("GitHub comment identifier was invalid.");
                }

                return String(existing.id);
            }

            if (payload.length < PAGE_SIZE) {
                return undefined;
            }
        }
    }

    /** 发布前确认事件中的 head SHA 仍是 PR 当前版本，防止旧工作流覆盖新结果。 */
    private async isCurrentRevision(revision: string): Promise<boolean> {
        const response = await this.request(this.pullRequestApiPath, { method: "GET" });
        const payload = await this.readJson(response);
        if (typeof payload !== "object" || payload === null) {
            throw new Error("GitHub pull request response was invalid.");
        }

        const pullRequest = payload as GitHubPullRequest;
        return typeof pullRequest.head?.sha === "string" && pullRequest.head.sha === revision;
    }

    private async createComment(body: string): Promise<void> {
        await this.request(`${this.pullRequestPath}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
        });
    }

    private async updateComment(commentId: string, body: string): Promise<void> {
        await this.request(
            `/repos/${toPathSegment(this.configuration.owner)}/${toPathSegment(this.configuration.repository)}/issues/comments/${toPathSegment(commentId)}`,
            {
                method: "PATCH",
                body: JSON.stringify({ body }),
            },
        );
    }

    private async request(path: string, init: RequestInit): Promise<Response> {
        const apiBaseUrl = `${(this.configuration.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "")}/`;
        const response = await this.send(
            new URL(path.replace(/^\//, ""), apiBaseUrl).toString(),
            {
                ...init,
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${this.configuration.accessToken}`,
                    "X-GitHub-Api-Version": GITHUB_API_VERSION,
                    ...(init.method === "GET" ? {} : { "Content-Type": "application/json" }),
                },
            },
        );

        if (!response.ok) {
            throw new Error("GitHub review comment request failed.");
        }

        return response;
    }

    private async readJson(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            throw new Error("GitHub review comment response was invalid.");
        }
    }
}
