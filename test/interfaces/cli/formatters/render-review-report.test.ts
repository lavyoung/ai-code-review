import { describe, expect, it } from "vitest";
import {
    renderReviewReport,
    renderReviewDeliveryStatus,
} from "../../../../src/interfaces/cli/formatters/render-review-report.js";

describe("renderReviewReport", () => {
    it("renders final delivery status without repeating review findings", () => {
        expect(renderReviewDeliveryStatus({
            wecomDelivery: { status: "failed", attempts: 3 },
            githubCommentDelivery: { status: "delivered" },
        })).toBe([
            "## AI Code Review Delivery",
            "",
            "- CI Log: delivered",
            "- WeCom: failed (attempts: 3)",
            "- GitHub PR comment: delivered",
        ].join("\n"));
    });

    it("renders only safe analyzer run statuses", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: { diff: "", files: [], chunks: [], excludedFileCount: 0, redactedValueCount: 0 },
                analysis: { summary: "No issues.", findings: [] },
                findings: [],
                suppressedCandidateCounts: {},
                analyzerRuns: [{
                    analyzer: { kind: "ai", id: "deepseek" },
                    status: "completed",
                    durationMs: 20,
                }],
                policy: { highestSeverity: null, shouldFail: false },
            },
        });

        expect(report).toContain("Analyzer status: deepseek=completed");
        expect(report).not.toContain("durationMs");
    });

    it("can omit delivery status when the caller will log it later", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: {
                    diff: "",
                    files: [],
                    chunks: [],
                    excludedFileCount: 0,
                    redactedValueCount: 0,
                },
                analysis: { summary: "No issues.", findings: [] },
                findings: [],
                suppressedCandidateCounts: {},
                policy: { shouldFail: false, highestSeverity: undefined },
            },
            includeDeliveryStatus: false,
        });

        expect(report).not.toContain("### Delivery Status");
    });

    it("renders a Markdown report without exposing sensitive values or paths", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: {
                    diff: "",
                    files: [{ path: "src/example.ts", status: "modified" }],
                    chunks: [],
                    excludedFileCount: 1,
                    redactedValueCount: 2,
                },
                analysis: {
                    summary: "token: exposed-value",
                    findings: [{
                        severity: "high",
                        title: "Authorization: Bearer exposed-value",
                        description: "The .env.production file contains a value.",
                        file: ".env.production",
                        line: 3,
                        suggestion: "Move token: exposed-value to a secret store.",
                    }],
                },
                findings: [{
                    severity: "high",
                    title: "Authorization: Bearer exposed-value",
                    description: "The .env.production file contains a value.",
                    file: ".env.production",
                    line: 3,
                    suggestion: "Move token: exposed-value to a secret store.",
                    chunkId: "chunk-1",
                    evidence: "+token: [REDACTED]",
                    verificationStatus: "verified",
                }],
                suppressedCandidateCounts: {},
                policy: {
                    highestSeverity: "high",
                    shouldFail: true,
                },
            },
        });

        expect(report).toContain("## AI Code Review");
        expect(report).toContain("Status: QUALITY GATE FAILED");
        expect(report).toContain("[verified] [high] Authorization: Bearer [REDACTED]");
        expect(report).toContain("Verified findings: 1");
        expect(report).toContain("Grounded findings: 0");
        expect(report).toContain("Suggestion: Move token: [REDACTED] to a secret store.");
        expect(report).not.toContain("exposed-value");
        expect(report).not.toContain(".env.production");
    });

    it("renders an empty finding list", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: {
                    diff: "",
                    files: [],
                    chunks: [],
                    excludedFileCount: 0,
                    redactedValueCount: 0,
                },
                analysis: {
                    summary: "No actionable issues found.",
                    findings: [],
                },
                findings: [],
                suppressedCandidateCounts: {},
                policy: {
                    highestSeverity: null,
                    shouldFail: false,
                },
            },
        });

        expect(report).toContain("Status: PASSED");
        expect(report).toContain("Highest severity: none");
        expect(report).toContain("No actionable findings.");
        expect(report).toContain("WeCom: disabled");
    });

    it("renders only the final WeCom delivery state", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: { diff: "", files: [], chunks: [], excludedFileCount: 0, redactedValueCount: 0 },
                analysis: { summary: "No issues.", findings: [] },
                findings: [],
                suppressedCandidateCounts: {},
                policy: { highestSeverity: null, shouldFail: false },
            },
            wecomDelivery: { status: "failed", attempts: 3 },
        });

        expect(report).toContain("WeCom: failed (attempts: 3)");
    });

    it("renders the GitHub PR comment publication state only when provided", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: { diff: "", files: [], chunks: [], excludedFileCount: 0, redactedValueCount: 0 },
                analysis: { summary: "No issues.", findings: [] },
                findings: [],
                suppressedCandidateCounts: {},
                policy: { highestSeverity: null, shouldFail: false },
            },
            githubCommentDelivery: { status: "failed" },
        });

        expect(report).toContain("GitHub PR comment: failed");
    });

    it("renders the CodeUp MR comment publication state only when provided", () => {
        const report = renderReviewReport({
            target: "main",
            result: {
                codeChange: { diff: "", files: [], chunks: [], excludedFileCount: 0, redactedValueCount: 0 },
                analysis: { summary: "No issues.", findings: [] },
                findings: [],
                suppressedCandidateCounts: {},
                policy: { highestSeverity: null, shouldFail: false },
            },
            codeupCommentDelivery: { status: "delivered" },
        });

        expect(report).toContain("CodeUp MR comment: delivered");
    });
});
