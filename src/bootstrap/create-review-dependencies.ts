import type { ReviewConfiguration } from "../application/configuration/review-configuration.js";
import { DeepSeekReviewAdapter } from "../infrastructure/ai/deepseek/deepseek-review-adapter.js";
import { resolveCliConfiguration } from "../infrastructure/configuration/resolve-cli-configuration.js";
import { CodeUpReviewCommentAdapter } from "../infrastructure/scm/codeup/codeup-review-comment-adapter.js";
import {
    CodeUpMergeRequestContextError,
    resolveCodeUpMergeRequestContext,
    type CodeUpMergeRequestContext,
} from "../infrastructure/scm/codeup/resolve-codeup-merge-request-context.js";
import { LocalGitDiffProvider } from "../infrastructure/scm/git/local-git-diff-provider.js";
import { GitHubReviewCommentAdapter } from "../infrastructure/scm/github/github-review-comment-adapter.js";
import {
    GitHubActionsContextError,
    resolveGitHubActionsPullRequestContext,
    type GitHubActionsPullRequestContext,
} from "../infrastructure/scm/github/resolve-github-actions-pull-request-context.js";
import { WeComNotifier } from "../infrastructure/notification/wecom/wecom-notifier.js";

/** CLI 运行时的外部平台上下文无效时抛出，避免接口层依赖具体平台错误类型。 */
export class ReviewPlatformContextError extends Error {
    public constructor(public readonly provider: "github" | "codeup") {
        super(`${provider} review context is invalid.`);
    }
}

/** 在唯一的装配边界创建评审用例所需的具体适配器。 */
export const createReviewDependencies = (
    configuration: ReviewConfiguration,
    workingDirectory: string,
) => ({
    diffProvider: new LocalGitDiffProvider(workingDirectory),
    reviewAnalyzer: new DeepSeekReviewAdapter(configuration.ai),
});

/** 解析 CLI 的多来源配置。 */
export const resolveCliReviewConfiguration = resolveCliConfiguration;

/** 将 GitHub Actions 事件载荷转换为应用层需要的 PR 范围。 */
export const resolveGitHubPullRequestContext = async (
    environment: NodeJS.ProcessEnv,
): Promise<GitHubActionsPullRequestContext> => {
    try {
        return await resolveGitHubActionsPullRequestContext(environment);
    } catch (error) {
        if (error instanceof GitHubActionsContextError) {
            throw new ReviewPlatformContextError("github");
        }

        throw error;
    }
};

/** 将 CodeUp Flow 事件变量转换为应用层需要的 MR 范围。 */
export const resolveCodeUpMergeRequestReviewContext = async (
    environment: NodeJS.ProcessEnv,
): Promise<CodeUpMergeRequestContext> => {
    try {
        return await resolveCodeUpMergeRequestContext(environment);
    } catch (error) {
        if (error instanceof CodeUpMergeRequestContextError) {
            throw new ReviewPlatformContextError("codeup");
        }

        throw error;
    }
};

/** 创建 GitHub PR 摘要评论适配器。 */
export const createGitHubReviewCommentPort = (
    context: GitHubActionsPullRequestContext,
    accessToken: string,
    apiBaseUrl?: string,
) => new GitHubReviewCommentAdapter({
    owner: context.repositoryOwner,
    repository: context.repositoryName,
    pullRequestNumber: context.pullRequestNumber,
    accessToken,
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
});

/** 创建 CodeUp MR 摘要评论适配器。 */
export const createCodeUpReviewCommentPort = (
    context: CodeUpMergeRequestContext,
    accessToken: string,
) => new CodeUpReviewCommentAdapter({
    apiBaseUrl: context.apiBaseUrl,
    accessToken,
    repositoryId: context.repositoryId,
    changeRequestId: context.changeRequestId,
    patchSetBizId: context.patchSetBizId,
    ...(context.organizationId === undefined ? {} : { organizationId: context.organizationId }),
});

/** 创建企业微信通知适配器。 */
export const createWeComNotifier = (webhookUrl: string) => new WeComNotifier(webhookUrl);
