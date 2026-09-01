import { z } from "zod";
import type { ReviewConfiguration } from "../../application/configuration/review-configuration.js";
import {
    SEVERITIES,
} from "../../domain/review/model/severity.js";
import {
    canonicalizeOutputLanguage,
    DEFAULT_OUTPUT_LANGUAGE,
} from "../../application/configuration/output-language.js";

const outputLanguageSchema = z.string().trim().min(1).max(64)
    .transform((value, context) => {
        try {
            return canonicalizeOutputLanguage(value);
        } catch {
            context.addIssue({ code: "custom", message: "Expected a BCP 47 language tag." });
            return z.NEVER;
        }
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
    typeScriptEnabled: z.boolean().optional(),
    typeScriptTimeoutMs: z.number().int().positive().optional(),
    sarifEnabled: z.boolean().optional(),
    sarifReportPath: z.string().trim().min(1).optional(),
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
        typeScriptEnabled: parseBooleanEnvironmentValue(sources.environment?.TYPESCRIPT_ANALYZER_ENABLED),
        typeScriptTimeoutMs: sources.environment?.TYPESCRIPT_ANALYZER_TIMEOUT_MS === undefined
            ? undefined
            : Number(sources.environment.TYPESCRIPT_ANALYZER_TIMEOUT_MS),
        sarifEnabled: parseBooleanEnvironmentValue(sources.environment?.SARIF_ANALYZER_ENABLED),
        sarifReportPath: optionalEnvironmentSecret(sources.environment?.SARIF_REPORT_PATH),
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

    if (wecomEnabled && webhookUrl === undefined) {
        throw new Error("WECOM_WEBHOOK_URL must be set when WeCom notifications are enabled.");
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
        },
        analyzers: {
            typescript: {
                enabled: cli.typeScriptEnabled
                    ?? environment.typeScriptEnabled
                    ?? file.typeScriptEnabled
                    ?? false,
                timeoutMs: cli.typeScriptTimeoutMs
                    ?? environment.typeScriptTimeoutMs
                    ?? file.typeScriptTimeoutMs
                    ?? 120_000,
            },
            sarif: {
                enabled: cli.sarifEnabled ?? environment.sarifEnabled ?? file.sarifEnabled ?? false,
                ...(cli.sarifReportPath ?? environment.sarifReportPath ?? file.sarifReportPath === undefined
                    ? {}
                    : { reportPath: cli.sarifReportPath ?? environment.sarifReportPath ?? file.sarifReportPath }),
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
