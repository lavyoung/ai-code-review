import {Command, InvalidArgumentError} from "commander";
import {randomUUID} from "node:crypto";
import {
    isReviewEventType,
    REVIEW_EVENT_TYPES,
    type ReviewEventType,
} from "../../../domain/review/model/review-event.js";
import {renderReviewDeliveryStatus, renderReviewReport,} from "../formatters/render-review-report.js";
import {redactReviewDiagnostic} from "../formatters/redact-review-diagnostic.js";
import {
    createCodeUpReviewCommentPort,
    createGitHubReviewCommentPort,
    createReviewDependencies,
    createReviewQualityStore,
    createWeComNotifier,
    resolveCliReviewConfiguration,
    resolveCodeUpMergeRequestReviewContext,
    resolveGitHubPullRequestContext,
    ReviewPlatformContextError,
} from "../../../bootstrap/create-review-dependencies.js";
import type {ManualReviewResult} from "../../../application/review/use-cases/run-manual-review-use-case.js";
import {runManualReviewUseCase} from "../../../application/review/use-cases/run-manual-review-use-case.js";
import {runPullRequestReviewUseCase} from "../../../application/review/use-cases/run-pull-request-review-use-case.js";
import {createSummaryReviewComment} from "../../../application/delivery/comments/create-summary-review-comment.js";
import {publishReviewCommentUseCase} from "../../../application/delivery/use-cases/publish-review-comment-use-case.js";
import {createReviewCommentId} from "../../../domain/review/model/review-comment.js";
import {
    AiReviewExecutionError,
    AiReviewFailure,
    DiffResolutionError,
    ReviewAnalyzerExecutionError,
    ReviewVerifierExecutionError,
} from "../../../application/review/errors/review-execution-error.js";
import {publishNotificationUseCase} from "../../../application/delivery/use-cases/publish-notification-use-case.js";
import {
    createSanitizedReviewRunRecord
} from "../../../application/review/recording/create-sanitized-review-run-record.js";
import {recordReviewRunUseCase} from "../../../application/review/recording/record-review-run-use-case.js";
import {CLI_EXIT_CODES, getAiReviewFailureExitCode,} from "../exit-code.js";

interface ReviewCommandOptions {
    event: ReviewEventType;
    provider: string;
    target?: string;
    config?: string;
    outputLanguage?: string;
    totalAnalyzerTimeoutMs?: number;
    maxAnalyzerConcurrency?: number;
    maxAiRequestCount?: number;
    maxModelInputChars?: number;
    typescriptEnabled?: boolean;
    typescriptAstEnabled?: boolean;
    javaAstEnabled?: boolean;
    sandboxTestEnabled?: boolean;
    sandboxTestReport?: string;
    sarifEnabled?: boolean;
    sarifReport?: string;
    secretScanEnabled?: boolean;
    deepseekEnabled?: boolean;
    runRecordPath?: string;
    qualityStoreEnabled?: boolean;
    qualityStoreEndpoint?: string;
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

const parseBoolean = (value: string, optionName: string): boolean => {
    if (value !== "true" && value !== "false") {
        throw new InvalidArgumentError(`${optionName} must be true or false.`);
    }

    return value === "true";
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
    .option("--max-model-input-chars <count>", "Maximum safe JSON diff characters per AI analyzer", (value) =>
        parsePositiveInteger(value, "--max-model-input-chars"))
    .option("--typescript-enabled <true|false>", "Enable the local TypeScript analyzer", (value) =>
        parseBoolean(value, "--typescript-enabled"))
    .option("--typescript-ast-enabled <true|false>", "Enable the local TypeScript AST analyzer", (value) =>
        parseBoolean(value, "--typescript-ast-enabled"))
    .option("--java-ast-enabled <true|false>", "Enable the local Java AST analyzer", (value) =>
        parseBoolean(value, "--java-ast-enabled"))
    .option("--sandbox-test-enabled <true|false>", "Enable signed sandbox test result analysis", (value) =>
        parseBoolean(value, "--sandbox-test-enabled"))
    .option("--sandbox-test-report <path>", "Signed sandbox test result report path")
    .option("--sarif-enabled <true|false>", "Enable the local SARIF analyzer", (value) =>
        parseBoolean(value, "--sarif-enabled"))
    .option("--sarif-report <path>", "Path to a SARIF 2.1.0 report")
    .option("--secret-scan-enabled <true|false>", "Enable the local high-confidence secret scanner", (value) =>
        parseBoolean(value, "--secret-scan-enabled"))
    .option("--deepseek-enabled <true|false>", "Enable the DeepSeek semantic analyzer", (value) =>
        parseBoolean(value, "--deepseek-enabled"))
    .option("--run-record-path <path>", "Append a sanitized review record as JSONL")
    .option("--quality-store-enabled <true|false>", "Enable the signed organization quality store", (value) =>
        parseBoolean(value, "--quality-store-enabled"))
    .option("--quality-store-endpoint <https-url>", "Organization quality store HTTPS endpoint")
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
                    ...(options.maxModelInputChars === undefined
                        ? {}
                        : { maxModelInputChars: options.maxModelInputChars }),
                    ...(options.typescriptEnabled === undefined
                        ? {}
                        : { typeScriptEnabled: options.typescriptEnabled }),
                    ...(options.typescriptAstEnabled === undefined
                        ? {}
                        : {typeScriptAstEnabled: options.typescriptAstEnabled}),
                    ...(options.javaAstEnabled === undefined
                        ? {}
                        : {javaAstEnabled: options.javaAstEnabled}),
                    ...(options.sandboxTestEnabled === undefined
                        ? {}
                        : {sandboxTestEnabled: options.sandboxTestEnabled}),
                    ...(options.sandboxTestReport === undefined
                        ? {}
                        : {sandboxTestReportPath: options.sandboxTestReport}),
                    ...(options.sarifEnabled === undefined ? {} : { sarifEnabled: options.sarifEnabled }),
                    ...(options.sarifReport === undefined ? {} : { sarifReportPath: options.sarifReport }),
                    ...(options.secretScanEnabled === undefined
                        ? {}
                        : { secretScanEnabled: options.secretScanEnabled }),
                    ...(options.deepseekEnabled === undefined
                        ? {}
                        : { deepSeekEnabled: options.deepseekEnabled }),
                    ...(options.runRecordPath === undefined
                        ? {}
                        : { reviewRunRecordPath: options.runRecordPath }),
                    ...(options.qualityStoreEnabled === undefined
                        ? {}
                        : {qualityStoreEnabled: options.qualityStoreEnabled}),
                    ...(options.qualityStoreEndpoint === undefined
                        ? {}
                        : {qualityStoreEndpointUrl: options.qualityStoreEndpoint}),
                },
            });
        } catch {
            console.error(
                "Configuration error. Check command options, environment variables, and configuration file.",
            );
            process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
            return;
        }

        if (configuration.analyzers.deepseek.enabled && configuration.ai.apiKey === undefined) {
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

        const runId = randomUUID();
        console.log(`AI Code Review Run ID: ${runId}`);

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
                runId,
                result,
                ...(configuration.notifications.wecom.enabled
                    ? { wecomDelivery: { status: "pending" as const } }
                    : {}),
            });
            console.log(renderReviewReport({
                target: reportTarget,
                runId,
                result,
                includeDeliveryStatus: false,
            }));

            const qualityStore = createReviewQualityStore(configuration);
            const recordingStatus = qualityStore === undefined
                ? undefined
                : await recordReviewRunUseCase(
                    createSanitizedReviewRunRecord(runId, result),
                    qualityStore,
                );
            if (recordingStatus !== undefined) {
                console.log(`Review record: ${recordingStatus}`);
            }

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
                            runId,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                        githubContext.headSha,
                        runId,
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
                            runId,
                            result,
                            ...(wecomDelivery === undefined ? {} : { wecomDelivery }),
                        }),
                        codeUpContext.headSha,
                        runId,
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
            console.error(`AI Code Review Run ID: ${runId}`);
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
                    console.error(`AI diagnostic: ${redactReviewDiagnostic(error.cause.message)}`);
                }
                process.exitCode = getAiReviewFailureExitCode(error.failureType);
                return;
            }

            if (error instanceof ReviewAnalyzerExecutionError) {
                console.error("Required review analyzer error. Check the enabled analyzer configuration.");
                process.exitCode = CLI_EXIT_CODES.REQUIRED_ANALYZER_FAILED;
                return;
            }

            if (error instanceof ReviewVerifierExecutionError) {
                console.error("Required review verifier error. Check the enabled verifier configuration.");
                process.exitCode = CLI_EXIT_CODES.REQUIRED_VERIFIER_FAILED;
                return;
            }

            console.error("AI review error. Review execution did not complete.");
            process.exitCode = CLI_EXIT_CODES.AI_UNKNOWN_FAILED;
        }
});

reviewCommand.exitOverride();
};
