import { Command, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../../domain/review/model/review-event.js";
import {
    renderReviewReport,
    renderReviewDeliveryStatus,
} from "../formatters/render-review-report.js";
import {
    createCodeUpReviewCommentPort,
    createGitHubReviewCommentPort,
    createReviewDependencies,
    createWeComNotifier,
    resolveCliReviewConfiguration,
    resolveCodeUpMergeRequestReviewContext,
    resolveGitHubPullRequestContext,
    ReviewPlatformContextError,
} from "../../../bootstrap/create-review-dependencies.js";
import { runManualReviewUseCase } from "../../../application/review/use-cases/run-manual-review-use-case.js";
import type { ManualReviewResult } from "../../../application/review/use-cases/run-manual-review-use-case.js";
import { runPullRequestReviewUseCase } from "../../../application/review/use-cases/run-pull-request-review-use-case.js";
import { createSummaryReviewComment } from "../../../application/delivery/comments/create-summary-review-comment.js";
import { publishReviewCommentUseCase } from "../../../application/delivery/use-cases/publish-review-comment-use-case.js";
import { createReviewCommentId } from "../../../domain/review/model/review-comment.js";
import {
    AiReviewFailure,
    AiReviewExecutionError,
    DiffResolutionError,
    ReviewAnalyzerExecutionError,
} from "../../../application/review/errors/review-execution-error.js";
import { publishNotificationUseCase } from "../../../application/delivery/use-cases/publish-notification-use-case.js";
import {
    CLI_EXIT_CODES,
    getAiReviewFailureExitCode,
} from "../exit-code.js";

interface ReviewCommandOptions {
    event: ReviewEventType;
    provider: string;
    target?: string;
    config?: string;
    outputLanguage?: string;
    totalAnalyzerTimeoutMs?: number;
    maxAnalyzerConcurrency?: number;
    maxAiRequestCount?: number;
}

const parseReviewEventType = (value: string): ReviewEventType => {
    if (!isReviewEventType(value)) {
        throw new InvalidArgumentError(
            `Invalid event "${value}". Expected one of: ${REVIEW_EVENT_TYPES.join(", ")}`,
        );
    }

    return value;
};

const parsePositiveInteger = (value: string, optionName: string): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new InvalidArgumentError(`${optionName} must be a positive integer.`);
    }

    return parsed;
};

/** 注册评审命令；命令层仅处理输入、输出和应用用例的调用。 */
export const configureReviewCommand = (program: Command): void => {
const reviewCommand = program
    .command("review")
    .description("Review committed Git changes")
    .requiredOption("--event <event>", "Review event", parseReviewEventType)
    .option("--provider <provider>", "Repository provider", "local")
    .option("--target <ref>", "Target branch or commit")
    .option("--config <path>", "Configuration file path")
    .option("--output-language <bcp47-tag>", "BCP 47 language tag for AI review text")
    .option("--total-analyzer-timeout-ms <milliseconds>", "Total analyzer execution timeout", (value) =>
        parsePositiveInteger(value, "--total-analyzer-timeout-ms"))
    .option("--max-analyzer-concurrency <count>", "Maximum concurrent analyzers", (value) =>
        parsePositiveInteger(value, "--max-analyzer-concurrency"))
    .option("--max-ai-request-count <count>", "Maximum AI analyzer requests", (value) =>
        parsePositiveInteger(value, "--max-ai-request-count"))
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
            configuration = await resolveCliReviewConfiguration({
                ...(options.config === undefined
                    ? {}
                    : { configurationPath: options.config }),
                cli: {
                    ...(options.outputLanguage === undefined
                        ? {}
                        : { outputLanguage: options.outputLanguage }),
                    ...(options.totalAnalyzerTimeoutMs === undefined
                        ? {}
                        : { totalTimeoutMs: options.totalAnalyzerTimeoutMs }),
                    ...(options.maxAnalyzerConcurrency === undefined
                        ? {}
                        : { maxAnalyzerConcurrency: options.maxAnalyzerConcurrency }),
                    ...(options.maxAiRequestCount === undefined
                        ? {}
                        : { maxAiRequestCount: options.maxAiRequestCount }),
                },
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

        if (isCodeUpMergeRequestReview && configuration.comments.codeup.accessToken === undefined) {
            console.error("Configuration error. CODEUP_TOKEN must be set for CodeUp MR lookup.");
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        try {
            const dependencies = createReviewDependencies(configuration, process.cwd());
            let result: ManualReviewResult;
            let reportTarget: string;
            let githubContext;
            let codeUpContext;

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
                githubContext = await resolveGitHubPullRequestContext(process.env);
                result = await runPullRequestReviewUseCase({
                    baseSha: githubContext.baseSha,
                    headSha: githubContext.headSha,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = githubContext.baseRef;
            } else {
                codeUpContext = await resolveCodeUpMergeRequestReviewContext(process.env);
                result = await runPullRequestReviewUseCase({
                    baseSha: codeUpContext.baseSha,
                    headSha: codeUpContext.headSha,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = codeUpContext.targetRef;
            }

            const report = renderReviewReport({
                target: reportTarget,
                result,
                ...(configuration.notifications.wecom.enabled
                    ? { wecomDelivery: { status: "pending" as const } }
                    : {}),
            });
            console.log(renderReviewReport({
                target: reportTarget,
                result,
                includeDeliveryStatus: false,
            }));

            const webhookUrl = configuration.notifications.wecom.webhookUrl;
            const wecomDelivery = configuration.notifications.wecom.enabled && webhookUrl !== undefined
                ? await publishNotificationUseCase({ markdown: report }, createWeComNotifier(webhookUrl))
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
                        renderReviewReport({
                            target: reportTarget,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                    ),
                    createGitHubReviewCommentPort(
                        githubContext,
                        configuration.comments.github.accessToken,
                        process.env.GITHUB_API_URL,
                    ),
                )
                : undefined;
            const codeUpCommentDelivery = isCodeUpMergeRequestReview
                && configuration.comments.codeup.enabled
                && codeUpContext !== undefined
                && configuration.comments.codeup.accessToken !== undefined
                ? await publishReviewCommentUseCase(
                    createSummaryReviewComment(
                        createReviewCommentId(
                            "codeup",
                            codeUpContext.repositoryId,
                            codeUpContext.changeRequestId,
                        ),
                        renderReviewReport({
                            target: reportTarget,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                    ),
                    createCodeUpReviewCommentPort(codeUpContext, configuration.comments.codeup.accessToken),
                )
                : undefined;

            console.log(renderReviewDeliveryStatus({
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
            if (error instanceof ReviewPlatformContextError) {
                console.error(error.provider === "github"
                    ? "GitHub Actions event error. Check the pull_request event context."
                    : "CodeUp Flow event error. Check the required AICR_CODEUP_* variables.");
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
                if (error.cause instanceof AiReviewFailure) {
                    console.error(`AI diagnostic: ${error.cause.message}`);
                }
                process.exitCode = getAiReviewFailureExitCode(error.failureType);
                return;
            }

            if (error instanceof ReviewAnalyzerExecutionError) {
                console.error("Required review analyzer error. Check the enabled analyzer configuration.");
                process.exitCode = CLI_EXIT_CODES.REQUIRED_ANALYZER_FAILED;
                return;
            }

            console.error("AI review error. Review execution did not complete.");
            process.exitCode = CLI_EXIT_CODES.AI_UNKNOWN_FAILED;
        }
});

reviewCommand.exitOverride();
};
