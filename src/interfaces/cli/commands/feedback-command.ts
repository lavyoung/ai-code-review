import {Command, InvalidArgumentError} from "commander";
import {
    FINDING_FEEDBACK_STATUSES,
    type FindingFeedbackStatus,
} from "../../../application/review/ports/review-run-record-port.js";
import {
    createSanitizedFindingFeedback,
    recordFindingFeedbackUseCase
} from "../../../application/review/recording/record-finding-feedback-use-case.js";
import {
    createReviewQualityStore,
    resolveCliReviewConfiguration
} from "../../../bootstrap/create-review-dependencies.js";
import {CLI_EXIT_CODES} from "../exit-code.js";

interface FeedbackCommandOptions {
    fingerprint: string;
    status: FindingFeedbackStatus;
    runId?: string;
    expiresAt?: string;
    config?: string;
    runRecordPath?: string;
    qualityStoreEnabled?: boolean;
    qualityStoreEndpoint?: string;
}

const parseFingerprint = (value: string): string => {
    const normalized = value.trim();
    if (!/^[a-f0-9]{24}$/.test(normalized)) {
        throw new InvalidArgumentError("--fingerprint must be a 24-character lowercase hexadecimal value.");
    }

    return normalized;
};

const parseFeedbackStatus = (value: string): FindingFeedbackStatus => {
    if (!FINDING_FEEDBACK_STATUSES.includes(value as FindingFeedbackStatus)) {
        throw new InvalidArgumentError(`Invalid feedback status. Expected one of: ${FINDING_FEEDBACK_STATUSES.join(", ")}`);
    }

    return value as FindingFeedbackStatus;
};

const parseRunId = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalized)) {
        throw new InvalidArgumentError("--run-id must be an RFC 9562 UUID.");
    }

    return normalized;
};

const parseFutureTimestamp = (value: string): string => {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp) || timestamp <= Date.now()) {
        throw new InvalidArgumentError("--expires-at must be a future ISO 8601 timestamp.");
    }

    return new Date(timestamp).toISOString();
};

/** 注册人工反馈命令；它只接收稳定指纹和固定状态。 */
export const configureFeedbackCommand = (program: Command): void => {
    const feedbackCommand = program
        .command("feedback")
        .description("Record sanitized feedback for a review finding")
        .requiredOption("--fingerprint <fingerprint>", "Finding fingerprint", parseFingerprint)
        .requiredOption("--status <status>", "Feedback status", parseFeedbackStatus)
        .option("--run-id <run-id>", "Optional review run identifier", parseRunId)
        .option("--expires-at <timestamp>", "Optional expiry for false-positive or not-applicable suppression", parseFutureTimestamp)
        .option("--config <path>", "Configuration file path")
        .option("--run-record-path <path>", "Append feedback to a JSONL review record")
        .option("--quality-store-enabled <true|false>", "Enable the signed organization quality store", (value) =>
            value === "true" ? true : value === "false" ? false : (() => {
                throw new InvalidArgumentError("--quality-store-enabled must be true or false.");
            })())
        .option("--quality-store-endpoint <https-url>", "Organization quality store HTTPS endpoint")
        .action(async (options: FeedbackCommandOptions) => {
            if (options.expiresAt !== undefined
                && options.status !== "false-positive"
                && options.status !== "not-applicable") {
                console.error("--expires-at is only valid with false-positive or not-applicable feedback.");
                process.exitCode = CLI_EXIT_CODES.INVALID_ARGUMENT;
                return;
            }

            let qualityStore;
            try {
                const configuration = await resolveCliReviewConfiguration({
                    ...(options.config === undefined ? {} : { configurationPath: options.config }),
                    cli: {
                        ...(options.runRecordPath === undefined ? {} : {reviewRunRecordPath: options.runRecordPath}),
                        ...(options.qualityStoreEnabled === undefined
                            ? {}
                            : {qualityStoreEnabled: options.qualityStoreEnabled}),
                        ...(options.qualityStoreEndpoint === undefined
                            ? {}
                            : {qualityStoreEndpointUrl: options.qualityStoreEndpoint}),
                    },
                });
                qualityStore = createReviewQualityStore(configuration);
                if (qualityStore === undefined) {
                    throw new Error("A review quality store must be configured.");
                }
            } catch {
                console.error("Feedback configuration error. Configure a local record path or organization quality store.");
                process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
                return;
            }

            const status = await recordFindingFeedbackUseCase(
                createSanitizedFindingFeedback({
                    fingerprint: options.fingerprint,
                    status: options.status,
                    ...(options.runId === undefined ? {} : { runId: options.runId }),
                    ...(options.expiresAt === undefined ? {} : {expiresAt: options.expiresAt}),
                }),
                qualityStore,
            );
            console.log(`Finding feedback: ${status}`);
            process.exitCode = status === "delivered"
                ? CLI_EXIT_CODES.SUCCESS
                : CLI_EXIT_CODES.REVIEW_RECORDING_FAILED;
        });

    feedbackCommand.exitOverride();
};
