import {createReviewCommentId} from "../../../domain/review/model/review-comment.js";
import {
    ReviewTriggerConfigurationError,
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
import {GitHubReviewCommentAdapter} from "./github-review-comment-adapter.js";

export interface GitHubPullRequestReviewTriggerConfiguration {
    environment: NodeJS.ProcessEnv;
    commentEnabled: boolean;
    commentFailOnError: boolean;
    accessToken?: string;
    apiBaseUrl?: string;
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
        if (this.configuration.commentEnabled && this.configuration.accessToken === undefined) {
            throw new ReviewTriggerConfigurationError(
                this.providerId,
                this.event,
                "GITHUB_TOKEN must be set for GitHub PR comments.",
            );
        }
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
        && this.configuration.accessToken !== undefined
            ? {
                label: "GitHub PR comment",
                enabled: true as const,
                reviewId: createReviewCommentId("github", context.repository, context.pullRequestNumber),
                revision: context.headSha,
                port: new GitHubReviewCommentAdapter({
                    owner: context.repositoryOwner,
                    repository: context.repositoryName,
                    pullRequestNumber: context.pullRequestNumber,
                    accessToken: this.configuration.accessToken,
                    ...(this.configuration.apiBaseUrl === undefined ? {} : {apiBaseUrl: this.configuration.apiBaseUrl}),
                }),
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
