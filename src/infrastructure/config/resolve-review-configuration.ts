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
}).strict();

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
    });
    const cli = configurationOverrideSchema.parse(sources.cli ?? {});
    const apiKey = z.string().trim().min(1).optional().parse(
        sources.environment?.DEEPSEEK_API_KEY,
    );

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
    };
};
