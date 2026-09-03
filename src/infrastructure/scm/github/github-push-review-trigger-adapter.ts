import {ReviewTriggerContextError} from "../../../application/review/errors/review-trigger-error.js";
import type {
    ReviewTriggerAdapter,
    ReviewTriggerRequest,
    ReviewTriggerResolution,
} from "../../../application/review/ports/review-trigger-adapter.js";
import {
    GitHubActionsPushContextError,
    isDeletedBranchPush,
    isInitialPush,
    isTagPush,
    resolveGitHubActionsPushContext,
    type GitHubActionsPushContext,
} from "./resolve-github-actions-push-context.js";

type GitHubPushContextResolver = (environment: NodeJS.ProcessEnv) => Promise<GitHubActionsPushContext>;
type CheckedOutRevisionResolver = () => Promise<string>;

/** 将 GitHub Push 事件转换为精确 two-dot 范围，或一个合法跳过原因。 */
export class GitHubPushReviewTriggerAdapter implements ReviewTriggerAdapter {
    public readonly providerId = "github";
    public readonly event = "push" as const;

    public constructor(
        private readonly environment: NodeJS.ProcessEnv,
        private readonly resolveContext: GitHubPushContextResolver = resolveGitHubActionsPushContext,
        private readonly resolveCheckedOutRevision?: CheckedOutRevisionResolver,
    ) {
    }

    public validateConfiguration(): void {
        // Push 不创建平台摘要评论，也不需要额外平台写权限。
    }

    public async resolve(_: ReviewTriggerRequest): Promise<ReviewTriggerResolution> {
        let context: GitHubActionsPushContext;
        try {
            context = await this.resolveContext(this.environment);
        } catch (error) {
            if (error instanceof GitHubActionsPushContextError) {
                throw new ReviewTriggerContextError(this.providerId, this.event, error.message);
            }
            throw error;
        }
        if (isTagPush(context)) {
            return {kind: "skip", skip: {reason: "tag-push"}};
        }
        if (isDeletedBranchPush(context)) {
            return {kind: "skip", skip: {reason: "branch-deleted"}};
        }
        if (isInitialPush(context)) {
            return {kind: "skip", skip: {reason: "initial-push"}};
        }
        if (this.resolveCheckedOutRevision !== undefined) {
            const checkedOutRevision = (await this.resolveCheckedOutRevision()).toLowerCase();
            if (checkedOutRevision !== context.afterSha) {
                throw new ReviewTriggerContextError(
                    this.providerId,
                    this.event,
                    "Checked out revision did not match the GitHub push after commit.",
                );
            }
        }

        return {
            kind: "review",
            invocation: {
                providerId: this.providerId,
                event: this.event,
                repository: {id: context.repository, displayName: context.repository},
                range: {baseRef: context.beforeSha, headRef: context.afterSha, comparison: "two-dot"},
                reportTarget: context.branch.slice("refs/heads/".length),
            },
        };
    }
}
