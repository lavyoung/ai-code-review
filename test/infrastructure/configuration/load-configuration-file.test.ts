import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfigurationFile } from "../../../src/infrastructure/configuration/load-configuration-file.js";

const fixturePath = (name: string): string => fileURLToPath(
    new URL(`../../fixtures/${name}`, import.meta.url),
);

describe("loadConfigurationFile", () => {
    it("loads the supported nested YAML configuration", async () => {
        await expect(loadConfigurationFile(fixturePath("ai-code-review.yml")))
            .resolves.toEqual({
                severityThreshold: "low",
                failOn: ["high"],
                model: "deepseek-v4-flash",
                outputLanguage: "ja",
                timeoutMs: 10_000,
                wecomEnabled: false,
                wecomFailOnError: false,
                githubCommentEnabled: false,
                githubCommentFailOnError: false,
                codeUpCommentEnabled: false,
                codeUpCommentFailOnError: false,
            });
    });

    it("rejects an unsupported AI provider", async () => {
        await expect(loadConfigurationFile(fixturePath("invalid-ai-code-review.yml")))
            .rejects.toThrow();
    });
});
