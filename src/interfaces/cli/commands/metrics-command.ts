import { Command } from "commander";
import { resolveCliReviewConfiguration } from "../../../bootstrap/create-review-dependencies.js";
import { calculateReviewQualityMetrics } from "../../../application/review/quality/calculate-review-quality-metrics.js";
import { LocalJsonlReviewQualityRecordReader } from "../../../infrastructure/recording/local-jsonl-review-quality-record-reader.js";
import { CLI_EXIT_CODES } from "../exit-code.js";

interface MetricsCommandOptions {
    config?: string;
    runRecordPath?: string;
}

/** 注册本地质量指标命令；输出只含脱敏聚合值。 */
export const configureMetricsCommand = (program: Command): void => {
    const metricsCommand = program
        .command("metrics")
        .description("Calculate local quality metrics from sanitized JSONL records")
        .option("--config <path>", "Configuration file path")
        .option("--run-record-path <path>", "Read JSONL review records from this path")
        .action(async (options: MetricsCommandOptions) => {
            let recordPath: string | undefined;
            try {
                const configuration = await resolveCliReviewConfiguration({
                    ...(options.config === undefined ? {} : { configurationPath: options.config }),
                    cli: options.runRecordPath === undefined ? {} : { reviewRunRecordPath: options.runRecordPath },
                });
                recordPath = configuration.recording.localPath;
                if (recordPath === undefined) {
                    throw new Error("A review run record path must be configured.");
                }
            } catch {
                console.error("Metrics configuration error. Configure a review run record path.");
                process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
                return;
            }

            try {
                const records = await new LocalJsonlReviewQualityRecordReader(recordPath).readAll();
                console.log(JSON.stringify(calculateReviewQualityMetrics(records), null, 2));
                process.exitCode = CLI_EXIT_CODES.SUCCESS;
            } catch {
                console.error("Metrics record error. Check the sanitized JSONL review record.");
                process.exitCode = CLI_EXIT_CODES.REVIEW_RECORDING_FAILED;
            }
        });

    metricsCommand.exitOverride();
};
