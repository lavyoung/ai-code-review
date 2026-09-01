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
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../application/review-execution-error.js";
import { DeepSeekReviewAdapter } from "../../infrastructure/deepseek/deepseek-review-adapter.js";
import { LocalGitDiffProvider } from "../../infrastructure/git/local-git-diff-provider.js";
import {
    GitHubActionsContextError,
    resolveGitHubActionsPullRequestContext,
} from "../../infrastructure/github/resolve-github-actions-pull-request-context.js";
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

        if (!isManualReview && !isGitHubPullRequestReview) {
            console.error(
                "Supported modes: manual (--provider local --target <ref>) and GitHub pull-request (--provider github).",
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

        try {
            const dependencies = {
                diffProvider: new LocalGitDiffProvider(process.cwd()),
                aiReviewPort: new DeepSeekReviewAdapter(configuration.ai),
            };
            let result: ManualReviewResult;
            let reportTarget: string;

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
            } else {
                const githubContext = await resolveGitHubActionsPullRequestContext(process.env);
                result = await runPullRequestReviewUseCase({
                    baseSha: githubContext.baseSha,
                    headSha: githubContext.headSha,
                    failOn: configuration.review.failOn,
                }, dependencies);
                reportTarget = githubContext.baseRef;
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

            console.log(renderManualReviewReport({
                target: reportTarget,
                result,
                ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
            }));

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
