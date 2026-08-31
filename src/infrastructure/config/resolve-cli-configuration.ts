import { resolve } from "node:path";
import type { ReviewConfiguration } from "../../domain/review/review-configuration.js";
import { loadConfigurationFile } from "./load-configuration-file.js";
import { resolveReviewConfiguration } from "./resolve-review-configuration.js";

const DEFAULT_CONFIGURATION_FILE = "ai-code-review.yml";

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
