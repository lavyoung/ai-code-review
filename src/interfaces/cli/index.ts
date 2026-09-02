#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import packageMetadata from "../../../package.json" with { type: "json" };
import { configureReviewCommand } from "./commands/review-command.js";
import { configureFeedbackCommand } from "./commands/feedback-command.js";
import { configureMetricsCommand } from "./commands/metrics-command.js";
import { CLI_EXIT_CODES } from "./exit-code.js";

const program = new Command();

program
    .name("ai-code-review")
    .description("AI-powered code review CLI")
    .version(packageMetadata.version);

configureReviewCommand(program);
configureFeedbackCommand(program);
configureMetricsCommand(program);
program.exitOverride();

try {
    await program.parseAsync();
} catch (error) {
    if (error instanceof CommanderError) {
        process.exitCode = error.exitCode === 0
            ? CLI_EXIT_CODES.SUCCESS
            : CLI_EXIT_CODES.INVALID_ARGUMENT;
    } else {
        throw error;
    }
}
