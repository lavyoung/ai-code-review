import { describe, expect, it } from "vitest";
import { resolveReviewConfiguration } from "../src/infrastructure/config/resolve-review-configuration.js";

describe("resolveReviewConfiguration", () => {
    it("uses defaults when no source provides a value", () => {
        const configuration = resolveReviewConfiguration({});

        expect(configuration.review).toEqual({
            severityThreshold: "medium",
            failOn: ["critical"],
        });
        expect(configuration.ai).toMatchObject({
            provider: "deepseek",
            model: "deepseek-v4-flash",
            timeoutMs: 30_000,
        });
        expect(configuration.notifications.wecom).toEqual({
            enabled: false,
            failOnError: false,
        });
    });

    it("applies CLI, environment, file, and default precedence", () => {
        const configuration = resolveReviewConfiguration({
            file: {
                severityThreshold: "low",
                failOn: ["high"],
                model: "file-model",
                timeoutMs: 10_000,
            },
            environment: {
                REVIEW_SEVERITY_THRESHOLD: "high",
                REVIEW_FAIL_ON: "critical,high",
                DEEPSEEK_MODEL: "environment-model",
                DEEPSEEK_TIMEOUT_MS: "20000",
                DEEPSEEK_API_KEY: "test-key",
                WECOM_ENABLED: "true",
                WECOM_FAIL_ON_ERROR: "true",
                WECOM_WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
            },
            cli: {
                severityThreshold: "critical",
                failOn: ["critical"],
                model: "cli-model",
                timeoutMs: 30_000,
            },
        });

        expect(configuration).toMatchObject({
            review: {
                severityThreshold: "critical",
                failOn: ["critical"],
            },
            ai: {
                provider: "deepseek",
                model: "cli-model",
                timeoutMs: 30_000,
                apiKey: "test-key",
            },
            notifications: {
                wecom: {
                    enabled: true,
                    failOnError: true,
                    webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
                },
            },
        });
    });

    it("rejects an invalid environment timeout", () => {
        expect(() =>
            resolveReviewConfiguration({
                environment: { DEEPSEEK_TIMEOUT_MS: "invalid" },
            }),
        ).toThrow();
    });

    it("accepts the API key only from the environment", () => {
        expect(() =>
            resolveReviewConfiguration({
                file: { apiKey: "file-key" },
            }),
        ).toThrow();

        expect(() =>
            resolveReviewConfiguration({
                cli: { apiKey: "cli-key" },
            }),
        ).toThrow();
    });

    it("requires an environment webhook URL for enabled WeCom notifications", () => {
        expect(() => resolveReviewConfiguration({
            file: { wecomEnabled: true },
        })).toThrow();
    });
});
