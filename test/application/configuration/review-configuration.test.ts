import {describe, expect, it} from "vitest";
import {resolveReviewConfiguration} from "../../../src/infrastructure/configuration/resolve-review-configuration.js";

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
        expect(configuration.execution).toEqual({
            totalTimeoutMs: 300_000,
            maxAnalyzerConcurrency: 3,
            maxAiRequestCount: 8,
            maxModelInputChars: 60_000,
        });
        expect(configuration.analyzers.typescript).toEqual({
            enabled: false,
            timeoutMs: 120_000,
        });
        expect(configuration.analyzers.typescriptAst).toEqual({enabled: false});
        expect(configuration.analyzers.javaAst).toEqual({enabled: false});
        expect(configuration.analyzers.sandboxTests).toEqual({enabled: false});
        expect(configuration.analyzers.deepseek).toEqual({ enabled: true });
        expect(configuration.analyzers.secretScan).toEqual({ enabled: false });
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
                totalTimeoutMs: 60_000,
                maxAnalyzerConcurrency: 1,
                maxAiRequestCount: 2,
                maxModelInputChars: 10_000,
                typeScriptEnabled: false,
                typeScriptTimeoutMs: 30_000,
            },
            environment: {
                REVIEW_SEVERITY_THRESHOLD: "high",
                REVIEW_FAIL_ON: "critical,high",
                DEEPSEEK_MODEL: "environment-model",
                REVIEW_OUTPUT_LANGUAGE: "zh-CN",
                DEEPSEEK_TIMEOUT_MS: "20000",
                REVIEW_TOTAL_ANALYZER_TIMEOUT_MS: "90000",
                REVIEW_MAX_ANALYZER_CONCURRENCY: "2",
                REVIEW_MAX_AI_REQUEST_COUNT: "4",
                REVIEW_MAX_MODEL_INPUT_CHARS: "20000",
                TYPESCRIPT_ANALYZER_ENABLED: "true",
                SECRET_SCAN_ANALYZER_ENABLED: "false",
                TYPESCRIPT_ANALYZER_TIMEOUT_MS: "60000",
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
                totalTimeoutMs: 120_000,
                maxAnalyzerConcurrency: 3,
                maxAiRequestCount: 6,
                maxModelInputChars: 30_000,
                typeScriptEnabled: true,
                typeScriptTimeoutMs: 90_000,
                secretScanEnabled: true,
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
            execution: {
                totalTimeoutMs: 120_000,
                maxAnalyzerConcurrency: 3,
                maxAiRequestCount: 6,
                maxModelInputChars: 30_000,
            },
            analyzers: {
                typescript: {
                    enabled: true,
                    timeoutMs: 90_000,
                },
                secretScan: {
                    enabled: true,
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

    it("treats an empty optional SARIF path as absent when the analyzer is disabled", () => {
        expect(resolveReviewConfiguration({
            environment: {
                SARIF_ANALYZER_ENABLED: "false",
                SARIF_REPORT_PATH: "",
            },
        }).analyzers.sarif).toEqual({ enabled: false });
    });

    it("allows DeepSeek to be disabled without an API key", () => {
        const configuration = resolveReviewConfiguration({
            environment: {
                DEEPSEEK_ANALYZER_ENABLED: "false",
                TYPESCRIPT_ANALYZER_ENABLED: "true",
            },
        });

        expect(configuration.analyzers.deepseek).toEqual({ enabled: false });
        expect(configuration.ai.apiKey).toBeUndefined();
    });

    it("allows the local secret scanner to be the only enabled analyzer", () => {
        expect(resolveReviewConfiguration({
            environment: {
                DEEPSEEK_ANALYZER_ENABLED: "false",
                SECRET_SCAN_ANALYZER_ENABLED: "true",
            },
        }).analyzers).toMatchObject({
            deepseek: { enabled: false },
            secretScan: { enabled: true },
        });
    });

    it("enables the TypeScript AST analyzer through normal configuration precedence", () => {
        expect(resolveReviewConfiguration({
            file: {typeScriptAstEnabled: false},
            environment: {TYPESCRIPT_AST_ANALYZER_ENABLED: "true"},
            cli: {typeScriptAstEnabled: false},
        }).analyzers.typescriptAst).toEqual({enabled: false});
    });

    it("enables the Java AST analyzer through normal configuration precedence", () => {
        expect(resolveReviewConfiguration({
            file: {javaAstEnabled: false},
            environment: {JAVA_AST_ANALYZER_ENABLED: "true"},
            cli: {javaAstEnabled: false},
        }).analyzers.javaAst).toEqual({enabled: false});
    });

    it("allows the Java AST analyzer to run without a DeepSeek API key", () => {
        expect(resolveReviewConfiguration({
            environment: {
                DEEPSEEK_ANALYZER_ENABLED: "false",
                JAVA_AST_ANALYZER_ENABLED: "true",
            },
        }).analyzers).toMatchObject({
            deepseek: {enabled: false},
            javaAst: {enabled: true},
        });
    });

    it("requires a signed sandbox report when sandbox test analysis is enabled", () => {
        expect(() => resolveReviewConfiguration({
            environment: {SANDBOX_TEST_ANALYZER_ENABLED: "true"},
        })).toThrow("SANDBOX_TEST_REPORT_PATH");

        expect(resolveReviewConfiguration({
            file: {sandboxTestEnabled: true, sandboxTestReportPath: "sandbox-result.json"},
            environment: {SANDBOX_TEST_SIGNING_SECRET: "sandbox-test-secret"},
        }).analyzers.sandboxTests).toEqual({
            enabled: true,
            reportPath: "sandbox-result.json",
            signingSecret: "sandbox-test-secret",
        });
    });

    it("requires at least one analyzer and a report path for enabled SARIF", () => {
        expect(() => resolveReviewConfiguration({
            environment: { DEEPSEEK_ANALYZER_ENABLED: "false" },
        })).toThrow("At least one review analyzer");

        expect(() => resolveReviewConfiguration({
            environment: {
                DEEPSEEK_ANALYZER_ENABLED: "false",
                SARIF_ANALYZER_ENABLED: "true",
            },
        })).toThrow("SARIF report path");
    });

    it("uses the configured local run record path with normal source precedence", () => {
        expect(resolveReviewConfiguration({
            file: { reviewRunRecordPath: "file.jsonl" },
            environment: { REVIEW_RUN_RECORD_PATH: "environment.jsonl" },
            cli: { reviewRunRecordPath: "cli.jsonl" },
        }).recording).toEqual({
            localPath: "cli.jsonl",
            qualityStore: {enabled: false},
        });
    });

    it("enables the organization quality store with an environment-only signing secret", () => {
        const configuration = resolveReviewConfiguration({
            file: {
                qualityStoreEnabled: true,
                qualityStoreEndpointUrl: "https://quality.example.test/events",
            },
            environment: {
                QUALITY_STORE_SIGNING_SECRET: "quality-store-secret",
            },
        });

        expect(configuration.recording.qualityStore).toEqual({
            enabled: true,
            endpointUrl: "https://quality.example.test/events",
            signingSecret: "quality-store-secret",
        });
    });

    it("requires a HTTPS endpoint and environment signing secret for an enabled quality store", () => {
        expect(() => resolveReviewConfiguration({
            environment: {QUALITY_STORE_ENABLED: "true"},
        })).toThrow("QUALITY_STORE_ENDPOINT_URL");

        expect(() => resolveReviewConfiguration({
            environment: {
                QUALITY_STORE_ENABLED: "true",
                QUALITY_STORE_ENDPOINT_URL: "http://quality.example.test/events",
                QUALITY_STORE_SIGNING_SECRET: "quality-store-secret",
            },
        })).toThrow();

        expect(() => resolveReviewConfiguration({
            file: {signingSecret: "must-not-be-accepted"},
        })).toThrow();
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
