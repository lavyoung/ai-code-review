import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import {
    SEVERITIES,
    type Severity,
} from "../../domain/review/model/severity.js";
import { canonicalizeOutputLanguage } from "../../application/configuration/output-language.js";

/**
 * 配置文件经校验后转换出的扁平覆盖项。
 */
export interface ConfigurationFileOverride {
    severityThreshold?: Severity;
    failOn?: Severity[];
    model?: string;
    outputLanguage?: string;
    timeoutMs?: number;
    totalTimeoutMs?: number;
    maxAnalyzerConcurrency?: number;
    maxAiRequestCount?: number;
    typeScriptEnabled?: boolean;
    typeScriptTimeoutMs?: number;
    sarifEnabled?: boolean;
    sarifReportPath?: string;
    wecomEnabled?: boolean;
    wecomFailOnError?: boolean;
    githubCommentEnabled?: boolean;
    githubCommentFailOnError?: boolean;
    codeUpCommentEnabled?: boolean;
    codeUpCommentFailOnError?: boolean;
}

const configurationFileSchema = z.object({
    review: z.object({
        severity_threshold: z.enum(SEVERITIES).optional(),
        fail_on: z.array(z.enum(SEVERITIES)).optional(),
    }).strict().optional(),
    ai: z.object({
        provider: z.literal("deepseek").optional(),
        model: z.string().trim().min(1).optional(),
        output_language: z.string().trim().min(1).max(64)
            .transform((value, context) => {
                try {
                    return canonicalizeOutputLanguage(value);
                } catch {
                    context.addIssue({ code: "custom", message: "Expected a BCP 47 language tag." });
                    return z.NEVER;
                }
            }).optional(),
        timeout_ms: z.number().int().positive().optional(),
    }).strict().optional(),
    execution: z.object({
        total_timeout_ms: z.number().int().positive().optional(),
        max_analyzer_concurrency: z.number().int().positive().optional(),
        max_ai_request_count: z.number().int().positive().optional(),
    }).strict().optional(),
    analyzers: z.object({
        typescript: z.object({
            enabled: z.boolean().optional(),
            timeout_ms: z.number().int().positive().optional(),
        }).strict().optional(),
        sarif: z.object({
            enabled: z.boolean().optional(),
            report_path: z.string().trim().min(1).optional(),
        }).strict().optional(),
    }).strict().optional(),
    notifiers: z.object({
        wecom: z.object({
            enabled: z.boolean().optional(),
            fail_on_error: z.boolean().optional(),
        }).strict().optional(),
    }).strict().optional(),
    comments: z.object({
        github: z.object({
            enabled: z.boolean().optional(),
            fail_on_error: z.boolean().optional(),
        }).strict().optional(),
        codeup: z.object({
            enabled: z.boolean().optional(),
            fail_on_error: z.boolean().optional(),
        }).strict().optional(),
    }).strict().optional(),
}).strict();

/**
 * 读取并校验 YAML 配置文件，再转换为内部覆盖项。
 *
 * @param path 配置文件路径。
 * @returns 可参与配置优先级合并的覆盖项。
 */
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
        ...(configuration.ai?.output_language === undefined
            ? {}
            : { outputLanguage: configuration.ai.output_language }),
        ...(configuration.ai?.timeout_ms === undefined
            ? {}
            : { timeoutMs: configuration.ai.timeout_ms }),
        ...(configuration.execution?.total_timeout_ms === undefined
            ? {}
            : { totalTimeoutMs: configuration.execution.total_timeout_ms }),
        ...(configuration.execution?.max_analyzer_concurrency === undefined
            ? {}
            : { maxAnalyzerConcurrency: configuration.execution.max_analyzer_concurrency }),
        ...(configuration.execution?.max_ai_request_count === undefined
            ? {}
            : { maxAiRequestCount: configuration.execution.max_ai_request_count }),
        ...(configuration.analyzers?.typescript?.enabled === undefined
            ? {}
            : { typeScriptEnabled: configuration.analyzers.typescript.enabled }),
        ...(configuration.analyzers?.typescript?.timeout_ms === undefined
            ? {}
            : { typeScriptTimeoutMs: configuration.analyzers.typescript.timeout_ms }),
        ...(configuration.analyzers?.sarif?.enabled === undefined
            ? {}
            : { sarifEnabled: configuration.analyzers.sarif.enabled }),
        ...(configuration.analyzers?.sarif?.report_path === undefined
            ? {}
            : { sarifReportPath: configuration.analyzers.sarif.report_path }),
        ...(configuration.notifiers?.wecom?.enabled === undefined
            ? {}
            : { wecomEnabled: configuration.notifiers.wecom.enabled }),
        ...(configuration.notifiers?.wecom?.fail_on_error === undefined
            ? {}
            : { wecomFailOnError: configuration.notifiers.wecom.fail_on_error }),
        ...(configuration.comments?.github?.enabled === undefined
            ? {}
            : { githubCommentEnabled: configuration.comments.github.enabled }),
        ...(configuration.comments?.github?.fail_on_error === undefined
            ? {}
            : { githubCommentFailOnError: configuration.comments.github.fail_on_error }),
        ...(configuration.comments?.codeup?.enabled === undefined
            ? {}
            : { codeUpCommentEnabled: configuration.comments.codeup.enabled }),
        ...(configuration.comments?.codeup?.fail_on_error === undefined
            ? {}
            : { codeUpCommentFailOnError: configuration.comments.codeup.fail_on_error }),
    };
};
