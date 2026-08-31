import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import {
    SEVERITIES,
    type Severity,
} from "../../domain/review/review-configuration.js";

export interface ConfigurationFileOverride {
    severityThreshold?: Severity;
    failOn?: Severity[];
    model?: string;
    timeoutMs?: number;
}

const configurationFileSchema = z.object({
    review: z.object({
        severity_threshold: z.enum(SEVERITIES).optional(),
        fail_on: z.array(z.enum(SEVERITIES)).optional(),
    }).strict().optional(),
    ai: z.object({
        provider: z.literal("deepseek").optional(),
        model: z.string().trim().min(1).optional(),
        timeout_ms: z.number().int().positive().optional(),
    }).strict().optional(),
}).strict();

export const loadConfigurationFile = async (
    path: string,
): Promise<ConfigurationFileOverride> => {
    const content = await readFile(path, "utf8");
    const configuration = configurationFileSchema.parse(parse(content));

    return {
        ...(configuration.review?.severity_threshold === undefined
            ? {}
            : { severityThreshold: configuration.review.severity_threshold }),
        ...(configuration.review?.fail_on === undefined
            ? {}
            : { failOn: configuration.review.fail_on }),
        ...(configuration.ai?.model === undefined
            ? {}
            : { model: configuration.ai.model }),
        ...(configuration.ai?.timeout_ms === undefined
            ? {}
            : { timeoutMs: configuration.ai.timeout_ms }),
    };
};
