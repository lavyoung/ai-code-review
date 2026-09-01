import { z } from "zod";
import type { ReviewConfiguration } from "../../application/config/review-configuration.js";
import {
    SEVERITIES,
} from "../../domain/review/severity.js";

const configurationOverrideSchema = z.object({
    severityThreshold: z.enum(SEVERITIES).optional(),
    failOn: z.array(z.enum(SEVERITIES)).optional(),
    model: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
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
        timeoutMs: sources.environment?.DEEPSEEK_TIMEOUT_MS === undefined
            ? undefined
            : Number(sources.environment.DEEPSEEK_TIMEOUT_MS),
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
        sources.environment?.DEEPSEEK_API_KEY,
    );
    const webhookUrl = z.string().url().optional().parse(
        sources.environment?.WECOM_WEBHOOK_URL,
    );
    const githubAccessToken = z.string().trim().min(1).optional().parse(
        sources.environment?.GITHUB_TOKEN,
    );
    const codeUpAccessToken = z.string().trim().min(1).optional().parse(
        sources.environment?.CODEUP_TOKEN,
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
            timeoutMs:
                cli.timeoutMs ?? environment.timeoutMs ?? file.timeoutMs ?? 30_000,
            ...(apiKey === undefined ? {} : { apiKey }),
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
