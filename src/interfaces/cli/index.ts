import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../domain/review/review-event.js";
import { renderManualReviewReport } from "./render-manual-review-report.js";
import { resolveCliConfiguration } from "../../infrastructure/config/resolve-cli-configuration.js";
import { runManualReviewUseCase } from "../../application/run-manual-review-use-case.js";
import type { ManualReviewResult } from "../../application/run-manual-review-use-case.js";
import { runPullRequestReviewUseCase } from "../../application/run-pull-request-review-use-case.js";
import { createSummaryReviewComment } from "../../application/create-summary-review-comment.js";
import { publishReviewCommentUseCase } from "../../application/publish-review-comment-use-case.js";
import { createReviewCommentId } from "../../domain/review/review-comment.js";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../application/review-execution-error.js";
import { DeepSeekReviewAdapter } from "../../infrastructure/deepseek/deepseek-review-adapter.js";
import { LocalGitDiffProvider } from "../../infrastructure/git/local-git-diff-provider.js";
import {
    GitHubActionsContextError,
    resolveGitHubActionsPullRequestContext,
    type GitHubActionsPullRequestContext,
} from "../../infrastructure/github/resolve-github-actions-pull-request-context.js";
import { GitHubReviewCommentAdapter } from "../../infrastructure/github/github-review-comment-adapter.js";
import {
    CodeUpMergeRequestContextError,
    resolveCodeUpMergeRequestContext,
    type CodeUpMergeRequestContext,
} from "../../infrastructure/codeup/resolve-codeup-merge-request-context.js";
import { CodeUpReviewCommentAdapter } from "../../infrastructure/codeup/codeup-review-comment-adapter.js";
import { WeComNotifier } from "../../infrastructure/notifiers/wecom-notifier.js";
import { publishNotificationUseCase } from "../../application/publish-notification-use-case.js";
import {
    CLI_EXIT_CODES,
    getAiReviewFailureExitCode,
} from "./exit-code.js";

interface ReviewCommandOptions {
    event: ReviewEventType;
    provider: string;
    target?: string;
    config?: string;
}

const parseReviewEventType = (value: string): ReviewEventType => {
    if (!isReviewEventType(value)) {
        throw new InvalidArgumentError(
            `Invalid event "${value}". Expected one of: ${REVIEW_EVENT_TYPES.join(", ")}`,
        );
    }

    return value;
};

const program = new Command();

program
    .name("ai-code-review")
    .description("AI-powered code review CLI")
    .version("0.1.0");

const reviewCommand = program
    .command("review")
    .description("Review committed Git changes")
    .requiredOption("--event <event>", "Review event", parseReviewEventType)
    .option("--provider <provider>", "Repository provider", "local")
    .option("--target <ref>", "Target branch or commit")
    .option("--config <path>", "Configuration file path")
    .action(async (options: ReviewCommandOptions) => {
        const isManualReview = options.event === "manual"
            && options.provider === "local"
            && options.target !== undefined;
        const isGitHubPullRequestReview = options.event === "pull-request"
            && options.provider === "github";
        const isCodeUpMergeRequestReview = options.event === "merge-request"
            && options.provider === "codeup";

        if (!isManualReview && !isGitHubPullRequestReview && !isCodeUpMergeRequestReview) {
            console.error(
                "Supported modes: manual (--provider local --target <ref>), GitHub pull-request, and CodeUp merge-request.",
            );
            process.exitCode = CLI_EXIT_CODES.INVALID_ARGUMENT;
            return;
        }

        let configuration;
        try {
            configuration = await resolveCliConfiguration({
                ...(options.config === undefined
                    ? {}
                    : { configurationPath: options.config }),
            });
        } catch {
            console.error(
                "Configuration error. Check command options, environment variables, and configuration file.",
            );
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        if (configuration.ai.apiKey === undefined) {
            console.error("Configuration error. DEEPSEEK_API_KEY must be set.");
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        if (isGitHubPullRequestReview
            && configuration.comments.github.enabled
            && configuration.comments.github.accessToken === undefined) {
            console.error("Configuration error. GITHUB_TOKEN must be set for GitHub PR comments.");
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        if (isCodeUpMergeRequestReview
            && configuration.comments.codeup.enabled
            && configuration.comments.codeup.accessToken === undefined) {
            console.error("Configuration error. CODEUP_TOKEN must be set for CodeUp MR comments.");
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        try {
            const dependencies = {
                diffProvider: new LocalGitDiffProvider(process.cwd()),
                aiReviewPort: new DeepSeekReviewAdapter(configuration.ai),
            };
            let result: ManualReviewResult;
            let reportTarget: string;
            let githubContext: GitHubActionsPullRequestContext | undefined;
            let codeUpContext: CodeUpMergeRequestContext | undefined;

            if (isManualReview) {
                const target = options.target;
                if (target === undefined) {
                    throw new Error("Manual review target was unavailable.");
                }

                result = await runManualReviewUseCase({
                    target,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = target;
            } else if (isGitHubPullRequestReview) {
                githubContext = await resolveGitHubActionsPullRequestContext(process.env);
                result = await runPullRequestReviewUseCase({
                    baseSha: githubContext.baseSha,
                    headSha: githubContext.headSha,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = githubContext.baseRef;
            } else {
                codeUpContext = resolveCodeUpMergeRequestContext(process.env);
                if (configuration.comments.codeup.enabled
                    && (codeUpContext.repositoryId === undefined
                        || codeUpContext.changeRequestId === undefined
                        || codeUpContext.patchSetBizId === undefined
                        || codeUpContext.apiBaseUrl === undefined)) {
                    throw new CodeUpMergeRequestContextError(
                        "CodeUp comment context was incomplete.",
                    );
                }
                result = await runPullRequestReviewUseCase({
                    baseSha: codeUpContext.baseSha,
                    headSha: codeUpContext.headSha,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = codeUpContext.targetRef;
            }

            const report = renderManualReviewReport({
                target: reportTarget,
                result,
                ...(configuration.notifications.wecom.enabled
                    ? { wecomDelivery: { status: "pending" as const } }
                    : {}),
            });
            const webhookUrl = configuration.notifications.wecom.webhookUrl;
            const wecomDelivery = configuration.notifications.wecom.enabled && webhookUrl !== undefined
                ? await publishNotificationUseCase(
                    { markdown: report },
                    new WeComNotifier(webhookUrl),
                )
                : undefined;

            const githubCommentDelivery = isGitHubPullRequestReview
                && configuration.comments.github.enabled
                && githubContext !== undefined
                && configuration.comments.github.accessToken !== undefined
                ? await publishReviewCommentUseCase(
                    createSummaryReviewComment(
                        createReviewCommentId(
                            "github",
                            githubContext.repository,
                            githubContext.pullRequestNumber,
                        ),
                        renderManualReviewReport({
                            target: reportTarget,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                    ),
                    new GitHubReviewCommentAdapter({
                        owner: githubContext.repositoryOwner,
                        repository: githubContext.repositoryName,
                        pullRequestNumber: githubContext.pullRequestNumber,
                        accessToken: configuration.comments.github.accessToken,
                        ...(process.env.GITHUB_API_URL === undefined
                            ? {}
                            : { apiBaseUrl: process.env.GITHUB_API_URL }),
                    }),
                )
                : undefined;
            const codeUpCommentDelivery = isCodeUpMergeRequestReview
                && configuration.comments.codeup.enabled
                && codeUpContext !== undefined
                && configuration.comments.codeup.accessToken !== undefined
                && codeUpContext.repositoryId !== undefined
                && codeUpContext.changeRequestId !== undefined
                && codeUpContext.patchSetBizId !== undefined
                && codeUpContext.apiBaseUrl !== undefined
                ? await publishReviewCommentUseCase(
                    createSummaryReviewComment(
                        createReviewCommentId(
                            "codeup",
                            codeUpContext.repositoryId,
                            codeUpContext.changeRequestId,
                        ),
                        renderManualReviewReport({
                            target: reportTarget,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                    ),
                    new CodeUpReviewCommentAdapter({
                        apiBaseUrl: codeUpContext.apiBaseUrl,
                        accessToken: configuration.comments.codeup.accessToken,
                        repositoryId: codeUpContext.repositoryId,
                        changeRequestId: codeUpContext.changeRequestId,
                        patchSetBizId: codeUpContext.patchSetBizId,
                        ...(codeUpContext.organizationId === undefined
                            ? {}
                            : { organizationId: codeUpContext.organizationId }),
                    }),
                )
                : undefined;

            console.log(renderManualReviewReport({
                target: reportTarget,
                result,
                ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                ...(githubCommentDelivery === undefined
                    ? (isGitHubPullRequestReview ? { githubCommentDelivery: { status: "disabled" as const } } : {})
                    : { githubCommentDelivery }),
                ...(codeUpCommentDelivery === undefined
                    ? (isCodeUpMergeRequestReview ? { codeupCommentDelivery: { status: "disabled" as const } } : {})
                    : { codeupCommentDelivery: codeUpCommentDelivery }),
            }));

            if ((githubCommentDelivery?.status === "failed" && configuration.comments.github.failOnError)
                || (codeUpCommentDelivery?.status === "failed" && configuration.comments.codeup.failOnError)) {
                process.exitCode = CLI_EXIT_CODES.COMMENT_PUBLICATION_FAILED;
                return;
            }

            if (wecomDelivery?.status === "failed" && configuration.notifications.wecom.failOnError) {
                process.exitCode = CLI_EXIT_CODES.NOTIFICATION_PUBLICATION_FAILED;
                return;
            }

            process.exitCode = result.policy.shouldFail
                ? CLI_EXIT_CODES.QUALITY_GATE_FAILED
                : CLI_EXIT_CODES.SUCCESS;
        } catch (error) {
            if (error instanceof GitHubActionsContextError) {
                console.error("GitHub Actions event error. Check the pull_request event context.");
                process.exitCode = CLI_EXIT_CODES.INVALID_ARGUMENT;
                return;
            }

            if (error instanceof CodeUpMergeRequestContextError) {
                console.error("CodeUp Flow event error. Check the required AICR_CODEUP_* variables.");
                process.exitCode = CLI_EXIT_CODES.INVALID_ARGUMENT;
                return;
            }

            if (error instanceof DiffResolutionError) {
                console.error("Git diff error. Check the repository and target reference.");
                process.exitCode = CLI_EXIT_CODES.GIT_DIFF_FAILED;
                return;
            }

            if (error instanceof AiReviewExecutionError) {
                console.error("AI review error. Check the DeepSeek configuration and service status.");
                process.exitCode = getAiReviewFailureExitCode(error.failureType);
                return;
            }

            console.error("AI review error. Review execution did not complete.");
            process.exitCode = CLI_EXIT_CODES.AI_UNKNOWN_FAILED;
        }
    });

program.exitOverride();
reviewCommand.exitOverride();

try {
    await program.parseAsync();
} catch (error) {
    if (error instanceof CommanderError && error.exitCode !== 0) {
        process.exitCode = CLI_EXIT_CODES.INVALID_ARGUMENT;
    } else {
        throw error;
    }
}
