import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../domain/review/review-event.js";
import { redactReviewConfiguration } from "./redact-review-configuration.js";
import { resolveCliConfiguration } from "../../infrastructure/config/resolve-cli-configuration.js";
import { runManualReviewUseCase } from "../../application/run-manual-review-use-case.js";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../application/review-execution-error.js";
import { DeepSeekReviewAdapter } from "../../infrastructure/deepseek/deepseek-review-adapter.js";
import { LocalGitDiffProvider } from "../../infrastructure/git/local-git-diff-provider.js";
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
        if (options.event !== "manual" || options.provider !== "local" || options.target === undefined) {
            console.error(
                "Only manual reviews with --provider local and --target <ref> are currently supported.",
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
            const result = await runManualReviewUseCase({
                target: options.target,
                failOn: configuration.review.failOn,
            }, {
                diffProvider: new LocalGitDiffProvider(process.cwd()),
                aiReviewPort: new DeepSeekReviewAdapter(configuration.ai),
            });

            console.log(JSON.stringify({
                ...options,
                configuration: redactReviewConfiguration(configuration),
                change: {
                    hasChanges: result.codeChange.diff.length > 0,
                    changedFileCount: result.codeChange.files.length,
                    excludedFileCount: result.codeChange.excludedFileCount,
                    redactedValueCount: result.codeChange.redactedValueCount,
                },
                review: {
                    summary: result.analysis.summary,
                    findings: result.analysis.findings,
                    highestSeverity: result.policy.highestSeverity,
                    shouldFail: result.policy.shouldFail,
                },
            }, null, 2));
            process.exitCode = result.policy.shouldFail
                ? CLI_EXIT_CODES.QUALITY_GATE_FAILED
                : CLI_EXIT_CODES.SUCCESS;
        } catch (error) {
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
