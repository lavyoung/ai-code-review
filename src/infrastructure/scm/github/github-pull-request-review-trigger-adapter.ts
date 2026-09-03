import {createReviewCommentId} from "../../../domain/review/model/review-comment.js";
import {
    ReviewTriggerContextError,
} from "../../../application/review/errors/review-trigger-error.js";
import type {
    ReviewTriggerAdapter,
    ReviewTriggerRequest,
    ReviewTriggerResolution,
} from "../../../application/review/ports/review-trigger-adapter.js";
import {
    GitHubActionsContextError,
    type GitHubActionsPullRequestContext,
    resolveGitHubActionsPullRequestContext,
} from "./resolve-github-actions-pull-request-context.js";

export interface GitHubPullRequestReviewTriggerConfiguration {
    environment: NodeJS.ProcessEnv;
    commentEnabled: boolean;
    commentFailOnError: boolean;
}

type GitHubPullRequestContextResolver = (
    environment: NodeJS.ProcessEnv,
) => Promise<GitHubActionsPullRequestContext>;

/** 将 GitHub Actions PR 事件转换为统一评审调用和可选摘要评论端口。 */
export class GitHubPullRequestReviewTriggerAdapter implements ReviewTriggerAdapter {
    public readonly providerId = "github";
    public readonly event = "pull-request" as const;

    public constructor(
        private readonly configuration: GitHubPullRequestReviewTriggerConfiguration,
        private readonly resolveContext: GitHubPullRequestContextResolver = resolveGitHubActionsPullRequestContext,
    ) {
    }

    public validateConfiguration(): void {
        // GitHub 评论凭据由 Delivery Adapter 验证，Trigger 只解析事件上下文。
    }

    public async resolve(_: ReviewTriggerRequest): Promise<ReviewTriggerResolution> {
        let context: GitHubActionsPullRequestContext;
        try {
            context = await this.resolveContext(this.configuration.environment);
        } catch (error) {
            if (error instanceof GitHubActionsContextError) {
                throw new ReviewTriggerContextError(this.providerId, this.event, error.message);
            }
            throw error;
        }

        const summaryComment = this.configuration.commentEnabled
            ? {
                label: "GitHub PR comment",
                enabled: true as const,
                target: {
                    providerId: this.providerId,
                    label: "GitHub PR comment",
                    reviewId: createReviewCommentId("github", context.repository, context.pullRequestNumber),
                    revision: context.headSha,
                    attributes: {
                        owner: context.repositoryOwner,
                        repository: context.repositoryName,
                        pullRequestNumber: context.pullRequestNumber,
                    },
                },
                failOnError: this.configuration.commentFailOnError,
            }
            : {
                label: "GitHub PR comment",
                enabled: false as const,
                failOnError: this.configuration.commentFailOnError,
            };

        return {
            kind: "review",
            invocation: {
                providerId: this.providerId,
                event: this.event,
                repository: {id: context.repository, displayName: context.repository},
                range: {baseRef: context.baseSha, headRef: context.headSha, comparison: "three-dot"},
                reportTarget: context.baseRef,
                summaryComment,
            },
        };
    }
}
