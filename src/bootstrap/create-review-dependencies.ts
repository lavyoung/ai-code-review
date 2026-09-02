import type { ReviewConfiguration } from "../application/configuration/review-configuration.js";
import { DeepSeekReviewAdapter } from "../infrastructure/ai/deepseek/deepseek-review-adapter.js";
import { TypeScriptReviewAnalyzer } from "../infrastructure/analyzers/typescript/typescript-review-analyzer.js";
import { SarifReviewAnalyzer } from "../infrastructure/analyzers/sarif/sarif-review-analyzer.js";
import { SecretScanReviewAnalyzer } from "../infrastructure/analyzers/secret-scan/secret-scan-review-analyzer.js";
import { StaticReviewAnalyzerRegistry } from "../application/review/orchestration/static-review-analyzer-registry.js";
import { deterministicAnalyzerFindingVerifier } from "../application/review/verification/deterministic-analyzer-finding-verifier.js";
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
) => {
    const deepSeekAnalyzer = configuration.analyzers.deepseek.enabled
        ? new DeepSeekReviewAdapter(configuration.ai)
        : undefined;
    const typeScriptAnalyzer = new TypeScriptReviewAnalyzer(workingDirectory);
    const sarifAnalyzer = configuration.analyzers.sarif.enabled && configuration.analyzers.sarif.reportPath !== undefined
        ? new SarifReviewAnalyzer(workingDirectory, configuration.analyzers.sarif.reportPath)
        : undefined;
    if (configuration.analyzers.sarif.enabled && sarifAnalyzer === undefined) {
        throw new Error("SARIF report path must be configured when the SARIF analyzer is enabled.");
    }
    const secretScanAnalyzer = configuration.analyzers.secretScan.enabled
        ? new SecretScanReviewAnalyzer()
        : undefined;
    const analyzers = [...(deepSeekAnalyzer === undefined ? [] : [deepSeekAnalyzer]), ...(configuration.analyzers.typescript.enabled ? [typeScriptAnalyzer] : []), ...(sarifAnalyzer === undefined ? [] : [sarifAnalyzer]), ...(secretScanAnalyzer === undefined ? [] : [secretScanAnalyzer])];
    if (analyzers.length === 0) {
        throw new Error("At least one review analyzer must be enabled.");
    }
    const analyzerPlans = [...(deepSeekAnalyzer === undefined ? [] : [{
        analyzerId: deepSeekAnalyzer.identity.id,
        required: true,
        timeoutMs: configuration.ai.timeoutMs,
        failureMode: "fail" as const,
    }]), ...(configuration.analyzers.typescript.enabled
        ? [{
            analyzerId: typeScriptAnalyzer.identity.id,
            required: true,
            timeoutMs: configuration.analyzers.typescript.timeoutMs,
            failureMode: "fail" as const,
        }]
        : [])];
    if (sarifAnalyzer !== undefined) {
        analyzerPlans.push({ analyzerId: sarifAnalyzer.identity.id, required: true, timeoutMs: 60_000, failureMode: "fail" });
    }
    if (secretScanAnalyzer !== undefined) {
        analyzerPlans.push({ analyzerId: secretScanAnalyzer.identity.id, required: true, timeoutMs: 5_000, failureMode: "fail" });
    }

    return {
        diffProvider: new LocalGitDiffProvider(workingDirectory),
        reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry(analyzers),
        analyzerPlans,
        analyzerBudget: {
            totalTimeoutMs: configuration.execution.totalTimeoutMs,
            maxConcurrency: configuration.execution.maxAnalyzerConcurrency,
            maxAiRequestCount: configuration.execution.maxAiRequestCount,
            maxModelInputChars: configuration.execution.maxModelInputChars,
        },
        findingVerifiers: [deterministicAnalyzerFindingVerifier],
    };
};

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
