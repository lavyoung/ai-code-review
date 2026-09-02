import { resolve } from "node:path";
import type { ReviewConfiguration } from "../../application/configuration/review-configuration.js";
import { loadConfigurationFile } from "./load-configuration-file.js";
import { resolveReviewConfiguration } from "./resolve-review-configuration.js";

const DEFAULT_CONFIGURATION_FILE = "ai-code-review.yml";

/**
 * CLI 配置解析使用的外部输入源。
 */
export interface CliConfigurationSources {
    configurationPath?: string;
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
    cli?: unknown;
}

const isMissingFileError = (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";

/**
 * 按 CLI、环境变量、配置文件、默认值的优先级解析评审配置。
 *
 * 未显式指定配置文件时，默认文件不存在不会报错；显式路径则必须可读取且合法。
 */
export const resolveCliConfiguration = async (
    sources: CliConfigurationSources = {},
): Promise<ReviewConfiguration> => {
    const path = sources.configurationPath
        ?? resolve(sources.cwd ?? process.cwd(), DEFAULT_CONFIGURATION_FILE);

    try {
        const file = await loadConfigurationFile(path);

        return resolveReviewConfiguration({
            file,
            environment: sources.environment ?? process.env,
            cli: sources.cli,
        });
    } catch (error) {
        if (sources.configurationPath === undefined && isMissingFileError(error)) {
            return resolveReviewConfiguration({
                environment: sources.environment ?? process.env,
                cli: sources.cli,
            });
        }

        throw error;
    }
};
