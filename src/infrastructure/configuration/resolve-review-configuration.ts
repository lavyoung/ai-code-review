import {z} from "zod";
import type {ReviewConfiguration} from "../../application/configuration/review-configuration.js";
import {SEVERITIES,} from "../../domain/review/model/severity.js";
import {canonicalizeOutputLanguage, DEFAULT_OUTPUT_LANGUAGE,} from "../../application/configuration/output-language.js";

const outputLanguageSchema = z.string().trim().min(1).max(64)
    .transform((value, context) => {
        try {
            return canonicalizeOutputLanguage(value);
        } catch {
            context.addIssue({ code: "custom", message: "Expected a BCP 47 language tag." });
            return z.NEVER;
        }
    });

const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", {
    message: "Expected an HTTPS URL.",
});

const configurationOverrideSchema = z.object({
    severityThreshold: z.enum(SEVERITIES).optional(),
    failOn: z.array(z.enum(SEVERITIES)).optional(),
    model: z.string().trim().min(1).optional(),
    outputLanguage: outputLanguageSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
    totalTimeoutMs: z.number().int().positive().optional(),
    maxAnalyzerConcurrency: z.number().int().positive().optional(),
    maxAiRequestCount: z.number().int().positive().optional(),
    maxModelInputChars: z.number().int().min(1_024).optional(),
    typeScriptEnabled: z.boolean().optional(),
    typeScriptTimeoutMs: z.number().int().positive().optional(),
    typeScriptAstEnabled: z.boolean().optional(),
    sarifEnabled: z.boolean().optional(),
    sarifReportPath: z.string().trim().min(1).optional(),
    secretScanEnabled: z.boolean().optional(),
    deepSeekEnabled: z.boolean().optional(),
    reviewRunRecordPath: z.string().trim().min(1).optional(),
    qualityStoreEnabled: z.boolean().optional(),
    qualityStoreEndpointUrl: httpsUrlSchema.optional(),
    wecomEnabled: z.boolean().optional(),
    wecomFailOnError: z.boolean().optional(),
    githubCommentEnabled: z.boolean().optional(),
    githubCommentFailOnError: z.boolean().optional(),
    codeUpCommentEnabled: z.boolean().optional(),
    codeUpCommentFailOnError: z.boolean().optional(),
}).strict();

const parseBooleanEnvironmentValue = (value: string | undefined): boolean | string | undefined => {
    if (value === undefined || value === "true" || value === "false") {
        return value === undefined ? undefined : value === "true";
    }

    return value;
};

/** 将 CI 对未配置 Secret 注入的空字符串统一视为未提供。 */
const optionalEnvironmentSecret = (value: string | undefined): string | undefined => {
    const normalized = value?.trim();

    return normalized === "" || normalized === undefined ? undefined : normalized;
};

/**
 * 配置合并的候选来源，优先级由调用方固定为 CLI、环境变量、文件、默认值。
 */
export interface ConfigurationSources {
    file?: unknown;
    environment?: NodeJS.ProcessEnv;
    cli?: unknown;
}

/**
 * 校验并合并配置来源，且仅从环境变量读取 DeepSeek API Key。
 */
export const resolveReviewConfiguration = (
    sources: ConfigurationSources,
): ReviewConfiguration => {
    const file = configurationOverrideSchema.parse(sources.file ?? {});
    const environment = configurationOverrideSchema.parse({
        severityThreshold: sources.environment?.REVIEW_SEVERITY_THRESHOLD,
        failOn: sources.environment?.REVIEW_FAIL_ON
            ?.split(",")
            .map((severity: string) => severity.trim())
            .filter(Boolean),
        model: sources.environment?.DEEPSEEK_MODEL,
        outputLanguage: sources.environment?.REVIEW_OUTPUT_LANGUAGE,
        timeoutMs: sources.environment?.DEEPSEEK_TIMEOUT_MS === undefined
            ? undefined
            : Number(sources.environment.DEEPSEEK_TIMEOUT_MS),
        totalTimeoutMs: sources.environment?.REVIEW_TOTAL_ANALYZER_TIMEOUT_MS === undefined
            ? undefined
            : Number(sources.environment.REVIEW_TOTAL_ANALYZER_TIMEOUT_MS),
        maxAnalyzerConcurrency: sources.environment?.REVIEW_MAX_ANALYZER_CONCURRENCY === undefined
            ? undefined
            : Number(sources.environment.REVIEW_MAX_ANALYZER_CONCURRENCY),
        maxAiRequestCount: sources.environment?.REVIEW_MAX_AI_REQUEST_COUNT === undefined
            ? undefined
            : Number(sources.environment.REVIEW_MAX_AI_REQUEST_COUNT),
        maxModelInputChars: sources.environment?.REVIEW_MAX_MODEL_INPUT_CHARS === undefined
            ? undefined
            : Number(sources.environment.REVIEW_MAX_MODEL_INPUT_CHARS),
        typeScriptEnabled: parseBooleanEnvironmentValue(sources.environment?.TYPESCRIPT_ANALYZER_ENABLED),
        typeScriptTimeoutMs: sources.environment?.TYPESCRIPT_ANALYZER_TIMEOUT_MS === undefined
            ? undefined
            : Number(sources.environment.TYPESCRIPT_ANALYZER_TIMEOUT_MS),
        typeScriptAstEnabled: parseBooleanEnvironmentValue(
            sources.environment?.TYPESCRIPT_AST_ANALYZER_ENABLED,
        ),
        sarifEnabled: parseBooleanEnvironmentValue(sources.environment?.SARIF_ANALYZER_ENABLED),
        sarifReportPath: optionalEnvironmentSecret(sources.environment?.SARIF_REPORT_PATH),
        secretScanEnabled: parseBooleanEnvironmentValue(sources.environment?.SECRET_SCAN_ANALYZER_ENABLED),
        deepSeekEnabled: parseBooleanEnvironmentValue(sources.environment?.DEEPSEEK_ANALYZER_ENABLED),
        reviewRunRecordPath: optionalEnvironmentSecret(sources.environment?.REVIEW_RUN_RECORD_PATH),
        qualityStoreEnabled: parseBooleanEnvironmentValue(sources.environment?.QUALITY_STORE_ENABLED),
        qualityStoreEndpointUrl: optionalEnvironmentSecret(sources.environment?.QUALITY_STORE_ENDPOINT_URL),
        wecomEnabled: parseBooleanEnvironmentValue(sources.environment?.WECOM_ENABLED),
        wecomFailOnError: parseBooleanEnvironmentValue(
            sources.environment?.WECOM_FAIL_ON_ERROR,
        ),
        githubCommentEnabled: parseBooleanEnvironmentValue(
            sources.environment?.GITHUB_COMMENT_ENABLED,
        ),
        githubCommentFailOnError: parseBooleanEnvironmentValue(
            sources.environment?.GITHUB_COMMENT_FAIL_ON_ERROR,
        ),
        codeUpCommentEnabled: parseBooleanEnvironmentValue(
            sources.environment?.CODEUP_COMMENT_ENABLED,
        ),
        codeUpCommentFailOnError: parseBooleanEnvironmentValue(
            sources.environment?.CODEUP_COMMENT_FAIL_ON_ERROR,
        ),
    });
    const cli = configurationOverrideSchema.parse(sources.cli ?? {});
    const apiKey = z.string().trim().min(1).optional().parse(
        optionalEnvironmentSecret(sources.environment?.DEEPSEEK_API_KEY),
    );
    const webhookUrl = z.string().url().optional().parse(
        optionalEnvironmentSecret(sources.environment?.WECOM_WEBHOOK_URL),
    );
    const githubAccessToken = z.string().trim().min(1).optional().parse(
        optionalEnvironmentSecret(sources.environment?.GITHUB_TOKEN),
    );
    const codeUpAccessToken = z.string().trim().min(1).optional().parse(
        optionalEnvironmentSecret(sources.environment?.CODEUP_TOKEN),
    );
    const qualityStoreSigningSecret = z.string().trim().min(1).optional().parse(
        optionalEnvironmentSecret(sources.environment?.QUALITY_STORE_SIGNING_SECRET),
    );
    const wecomEnabled = cli.wecomEnabled
        ?? environment.wecomEnabled
        ?? file.wecomEnabled
        ?? false;
    const wecomFailOnError = cli.wecomFailOnError
        ?? environment.wecomFailOnError
        ?? file.wecomFailOnError
        ?? false;
    const githubCommentEnabled = cli.githubCommentEnabled
        ?? environment.githubCommentEnabled
        ?? file.githubCommentEnabled
        ?? false;
    const githubCommentFailOnError = cli.githubCommentFailOnError
        ?? environment.githubCommentFailOnError
        ?? file.githubCommentFailOnError
        ?? false;
    const codeUpCommentEnabled = cli.codeUpCommentEnabled
        ?? environment.codeUpCommentEnabled
        ?? file.codeUpCommentEnabled
        ?? false;
    const codeUpCommentFailOnError = cli.codeUpCommentFailOnError
        ?? environment.codeUpCommentFailOnError
        ?? file.codeUpCommentFailOnError
        ?? false;
    const deepSeekEnabled = cli.deepSeekEnabled ?? environment.deepSeekEnabled ?? file.deepSeekEnabled ?? true;
    const typeScriptEnabled = cli.typeScriptEnabled
        ?? environment.typeScriptEnabled
        ?? file.typeScriptEnabled
        ?? false;
    const typeScriptAstEnabled = cli.typeScriptAstEnabled
        ?? environment.typeScriptAstEnabled
        ?? file.typeScriptAstEnabled
        ?? false;
    const sarifEnabled = cli.sarifEnabled ?? environment.sarifEnabled ?? file.sarifEnabled ?? false;
    const secretScanEnabled = cli.secretScanEnabled
        ?? environment.secretScanEnabled
        ?? file.secretScanEnabled
        ?? false;
    const sarifReportPath = cli.sarifReportPath ?? environment.sarifReportPath ?? file.sarifReportPath;
    const reviewRunRecordPath = cli.reviewRunRecordPath
        ?? environment.reviewRunRecordPath
        ?? file.reviewRunRecordPath;
    const qualityStoreEnabled = cli.qualityStoreEnabled
        ?? environment.qualityStoreEnabled
        ?? file.qualityStoreEnabled
        ?? false;
    const qualityStoreEndpointUrl = cli.qualityStoreEndpointUrl
        ?? environment.qualityStoreEndpointUrl
        ?? file.qualityStoreEndpointUrl;

    if (wecomEnabled && webhookUrl === undefined) {
        throw new Error("WECOM_WEBHOOK_URL must be set when WeCom notifications are enabled.");
    }

    if (!deepSeekEnabled && !typeScriptEnabled && !sarifEnabled && !secretScanEnabled) {
        throw new Error("At least one review analyzer must be enabled.");
    }

    if (sarifEnabled && sarifReportPath === undefined) {
        throw new Error("A SARIF report path must be configured when the SARIF analyzer is enabled.");
    }

    if (qualityStoreEnabled
        && (qualityStoreEndpointUrl === undefined || qualityStoreSigningSecret === undefined)) {
        throw new Error("QUALITY_STORE_ENDPOINT_URL and QUALITY_STORE_SIGNING_SECRET must be set when the quality store is enabled.");
    }

    return {
        review: {
            severityThreshold:
                cli.severityThreshold
                ?? environment.severityThreshold
                ?? file.severityThreshold
                ?? "medium",
            failOn: cli.failOn ?? environment.failOn ?? file.failOn ?? ["critical"],
        },
        ai: {
            provider: "deepseek",
            model: cli.model ?? environment.model ?? file.model ?? "deepseek-v4-flash",
            outputLanguage:
                cli.outputLanguage
                ?? environment.outputLanguage
                ?? file.outputLanguage
                ?? DEFAULT_OUTPUT_LANGUAGE,
            timeoutMs:
                cli.timeoutMs ?? environment.timeoutMs ?? file.timeoutMs ?? 30_000,
            ...(apiKey === undefined ? {} : { apiKey }),
        },
        execution: {
            totalTimeoutMs: cli.totalTimeoutMs
                ?? environment.totalTimeoutMs
                ?? file.totalTimeoutMs
                ?? 300_000,
            maxAnalyzerConcurrency: cli.maxAnalyzerConcurrency
                ?? environment.maxAnalyzerConcurrency
                ?? file.maxAnalyzerConcurrency
                ?? 3,
            maxAiRequestCount: cli.maxAiRequestCount
                ?? environment.maxAiRequestCount
                ?? file.maxAiRequestCount
                ?? 8,
            maxModelInputChars: cli.maxModelInputChars
                ?? environment.maxModelInputChars
                ?? file.maxModelInputChars
                ?? 60_000,
        },
        analyzers: {
            deepseek: {
                enabled: deepSeekEnabled,
            },
            typescript: {
                enabled: typeScriptEnabled,
                timeoutMs: cli.typeScriptTimeoutMs
                    ?? environment.typeScriptTimeoutMs
                    ?? file.typeScriptTimeoutMs
                    ?? 120_000,
            },
            typescriptAst: {
                enabled: typeScriptAstEnabled,
            },
            sarif: {
                enabled: sarifEnabled,
                ...(sarifReportPath === undefined
                    ? {}
                    : { reportPath: sarifReportPath }),
            },
            secretScan: {
                enabled: secretScanEnabled,
            },
        },
        recording: {
            ...(reviewRunRecordPath === undefined
                ? {}
                : { localPath: reviewRunRecordPath }),
            qualityStore: {
                enabled: qualityStoreEnabled,
                ...(qualityStoreEndpointUrl === undefined ? {} : {endpointUrl: qualityStoreEndpointUrl}),
                ...(qualityStoreSigningSecret === undefined ? {} : {signingSecret: qualityStoreSigningSecret}),
            },
        },
        notifications: {
            wecom: {
                enabled: wecomEnabled,
                failOnError: wecomFailOnError,
                ...(webhookUrl === undefined ? {} : { webhookUrl }),
            },
        },
        comments: {
            github: {
                enabled: githubCommentEnabled,
                failOnError: githubCommentFailOnError,
                ...(githubAccessToken === undefined ? {} : { accessToken: githubAccessToken }),
            },
            codeup: {
                enabled: codeUpCommentEnabled,
                failOnError: codeUpCommentFailOnError,
                ...(codeUpAccessToken === undefined ? {} : { accessToken: codeUpAccessToken }),
            },
        },
    };
};
