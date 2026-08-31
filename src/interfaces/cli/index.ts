import { Command, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../domain/review/review-event.js";
import { redactReviewConfiguration } from "./redact-review-configuration.js";
import { resolveCliConfiguration } from "../../infrastructure/config/resolve-cli-configuration.js";

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
        try {
            const configuration = await resolveCliConfiguration({
                ...(options.config === undefined
                    ? {}
                    : { configurationPath: options.config }),
            });

            console.log(JSON.stringify({
                ...options,
                configuration: redactReviewConfiguration(configuration),
            }, null, 2));
        } catch {
            console.error(
                "Configuration error. Check command options, environment variables, and configuration file.",
            );
            process.exitCode = 20;
        }
    });

await program.parseAsync();
