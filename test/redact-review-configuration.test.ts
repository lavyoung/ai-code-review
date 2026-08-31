import { describe, expect, it } from "vitest";
import { redactReviewConfiguration } from "../src/interfaces/cli/redact-review-configuration.js";

describe("redactReviewConfiguration", () => {
    it("redacts the DeepSeek API key", () => {
        expect(redactReviewConfiguration({
            review: {
                severityThreshold: "medium",
                failOn: ["critical"],
            },
            ai: {
                provider: "deepseek",
                model: "deepseek-chat",
                timeoutMs: 30_000,
                apiKey: "secret-value",
            },
        })).toMatchObject({
            ai: {
                apiKey: "[REDACTED]",
            },
        });
    });
});
