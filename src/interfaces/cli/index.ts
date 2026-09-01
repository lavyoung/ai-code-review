import { Command, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../domain/review/review-event.js";
import { redactReviewConfiguration } from "./redact-review-configuration.js";
import { resolveCliConfiguration } from "../../infrastructure/config/resolve-cli-configuration.js";
import { resolveManualCodeChange } from "../../application/resolve-manual-code-change.js";
import { LocalGitDiffProvider } from "../../infrastructure/git/local-git-diff-provider.js";

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

program
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
            process.exitCode = 20;
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
            process.exitCode = 20;
            return;
        }

        try {
            const codeChange = await resolveManualCodeChange(
                new LocalGitDiffProvider(process.cwd()),
                options.target,
            );

            console.log(JSON.stringify({
                ...options,
                configuration: redactReviewConfiguration(configuration),
                change: {
                    hasChanges: codeChange.diff.length > 0,
                    changedFileCount: codeChange.files.length,
                    excludedFileCount: codeChange.excludedFileCount,
                    redactedValueCount: codeChange.redactedValueCount,
                },
            }, null, 2));
        } catch {
            console.error("Git diff error. Check the repository and target reference.");
            process.exitCode = 21;
        }
    });

await program.parseAsync();
