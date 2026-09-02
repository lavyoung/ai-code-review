import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCliConfiguration } from "../../../src/infrastructure/configuration/resolve-cli-configuration.js";

const fixturePath = (name: string): string => fileURLToPath(
    new URL(`../../fixtures/${name}`, import.meta.url),
);

describe("resolveCliConfiguration", () => {
    it("uses defaults when the implicit configuration file is absent", async () => {
        await expect(resolveCliConfiguration({
            cwd: fileURLToPath(new URL("./", import.meta.url)),
            environment: {},
        })).resolves.toMatchObject({
            review: {
                severityThreshold: "medium",
                failOn: ["critical"],
            },
            ai: {
                model: "deepseek-v4-flash",
                outputLanguage: "en",
                timeoutMs: 30_000,
            },
        });
    });

    it("applies CLI and environment overrides to an explicit configuration file", async () => {
        await expect(resolveCliConfiguration({
            configurationPath: fixturePath("ai-code-review.yml"),
            environment: {
                REVIEW_SEVERITY_THRESHOLD: "high",
                DEEPSEEK_MODEL: "environment-model",
                REVIEW_OUTPUT_LANGUAGE: "zh-cn",
            },
            cli: {
                severityThreshold: "critical",
            },
        })).resolves.toMatchObject({
            review: {
                severityThreshold: "critical",
                failOn: ["high"],
            },
            ai: {
                model: "environment-model",
                outputLanguage: "zh-CN",
                timeoutMs: 10_000,
            },
        });
    });

    it("rejects a missing explicit configuration file", async () => {
        await expect(resolveCliConfiguration({
            configurationPath: fixturePath("missing.yml"),
            environment: {},
        })).rejects.toMatchObject({ code: "ENOENT" });
    });
});
