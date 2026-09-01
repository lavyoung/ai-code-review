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
        expect(configuration.comments.github).toEqual({
            enabled: false,
            failOnError: false,
        });
        expect(configuration.comments.codeup).toEqual({
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
                outputLanguage: "ja",
                timeoutMs: 10_000,
            },
            environment: {
                REVIEW_SEVERITY_THRESHOLD: "high",
                REVIEW_FAIL_ON: "critical,high",
                DEEPSEEK_MODEL: "environment-model",
                REVIEW_OUTPUT_LANGUAGE: "zh-CN",
                DEEPSEEK_TIMEOUT_MS: "20000",
                DEEPSEEK_API_KEY: "test-key",
                WECOM_ENABLED: "true",
                WECOM_FAIL_ON_ERROR: "true",
                WECOM_WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
                GITHUB_COMMENT_ENABLED: "true",
                GITHUB_COMMENT_FAIL_ON_ERROR: "true",
                GITHUB_TOKEN: "github-test-token",
                CODEUP_COMMENT_ENABLED: "true",
                CODEUP_COMMENT_FAIL_ON_ERROR: "true",
                CODEUP_TOKEN: "codeup-test-token",
            },
            cli: {
                severityThreshold: "critical",
                failOn: ["critical"],
                model: "cli-model",
                outputLanguage: "ko",
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
                outputLanguage: "ko",
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
            comments: {
                github: {
                    enabled: true,
                    failOnError: true,
                    accessToken: "github-test-token",
                },
                codeup: {
                    enabled: true,
                    failOnError: true,
                    accessToken: "codeup-test-token",
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

    it("rejects a non-BCP-47 output language", () => {
        expect(() => resolveReviewConfiguration({
            environment: { REVIEW_OUTPUT_LANGUAGE: "Chinese" },
        })).toThrow();
    });

    it("treats blank CI secrets as absent", () => {
        const configuration = resolveReviewConfiguration({
            environment: {
                DEEPSEEK_API_KEY: "   ",
                GITHUB_TOKEN: "",
                CODEUP_TOKEN: "\t",
            },
        });

        expect(configuration.ai.apiKey).toBeUndefined();
        expect(configuration.comments.github.accessToken).toBeUndefined();
        expect(configuration.comments.codeup.accessToken).toBeUndefined();
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
