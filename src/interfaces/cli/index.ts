import { Command, InvalidArgumentError } from "commander";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
    type ReviewEventType,
} from "../../domain/review/review-event.js";

interface ReviewCommandOptions {
    event: ReviewEventType;
    provider: string;
    target?: string;
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
    .action((options: ReviewCommandOptions) => {
        console.log(JSON.stringify(options, null, 2));
    });

program.parse();