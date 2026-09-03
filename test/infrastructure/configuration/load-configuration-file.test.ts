import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {loadConfigurationFile} from "../../../src/infrastructure/configuration/load-configuration-file.js";

const fixturePath = (name: string): string => fileURLToPath(
    new URL(`../../fixtures/${name}`, import.meta.url),
);

describe("loadConfigurationFile", () => {
    it("loads the supported nested YAML configuration", async () => {
        await expect(loadConfigurationFile(fixturePath("ai-code-review.yml")))
            .resolves.toEqual({
                severityThreshold: "low",
                failOn: ["high"],
                aiProvider: "deepseek",
                model: "deepseek-v4-flash",
                outputLanguage: "ja",
                timeoutMs: 10_000,
                typeScriptEnabled: true,
                typeScriptTimeoutMs: 30_000,
                javaAstEnabled: true,
                wecomEnabled: false,
                wecomFailOnError: false,
                githubCommentEnabled: false,
                githubCommentFailOnError: false,
                codeUpCommentEnabled: false,
                codeUpCommentFailOnError: false,
            });
    });

    it("preserves an AI provider selection for the registered factory validation boundary", async () => {
        await expect(loadConfigurationFile(fixturePath("invalid-ai-code-review.yml")))
            .resolves.toEqual({aiProvider: "unsupported"});
    });

    it("loads generic delivery comment provider settings without accepting secrets in YAML", async () => {
        await expect(loadConfigurationFile(fixturePath("delivery-comments-ai-code-review.yml")))
            .resolves.toEqual({
                aiProvider: "deepseek",
                aiEnabled: false,
                commentProviders: {
                    github: {enabled: true, failOnError: true},
                    codeup: {enabled: false, failOnError: false},
                },
            });
    });
});
