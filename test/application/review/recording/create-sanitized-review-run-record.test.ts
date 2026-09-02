import { describe, expect, it } from "vitest";
import { createSanitizedReviewRunRecord } from "../../../../src/application/review/recording/create-sanitized-review-run-record.js";

describe("createSanitizedReviewRunRecord", () => {
    it("records only feedback-safe identity, status, and analyzer metadata", () => {
        const record = createSanitizedReviewRunRecord("run-123", {
            codeChange: {
                diff: "token: exposed-value",
                files: [{ path: ".env.production", status: "modified" }],
                chunks: [], excludedFileCount: 1, redactedValueCount: 1,
            },
            analysis: { summary: "secret in .env.production", findings: [] },
            findings: [{
                fingerprint: "0123456789abcdef01234567",
                severity: "high",
                title: "Secret",
                description: "token: exposed-value",
                file: ".env.production",
                chunkId: "chunk-1",
                evidence: "+token: exposed-value",
                verificationStatus: "verified",
                verificationMethods: ["diff-anchor"],
                analyzers: [{ kind: "secret-scan", id: "secret-scanner" }],
            }],
            suppressedCandidateCounts: {},
            analyzerRuns: [{
                analyzer: { kind: "secret-scan", id: "secret-scanner" },
                status: "completed",
                attempts: 1,
                durationMs: 12,
            }],
            policy: { highestSeverity: "high", shouldFail: true },
        }, "2026-09-02T00:00:00.000Z");

        expect(record).toEqual({
            schemaVersion: "v1",
            recordType: "review-run",
            runId: "run-123",
            recordedAt: "2026-09-02T00:00:00.000Z",
            qualityGateFailed: true,
            highestSeverity: "high",
            analyzerRuns: [{ analyzerId: "secret-scan:secret-scanner", status: "completed", attempts: 1, durationMs: 12 }],
            findings: [{
                fingerprint: "0123456789abcdef01234567",
                severity: "high",
                verificationStatus: "verified",
                analyzerIds: ["secret-scan:secret-scanner"],
            }],
        });
        expect(JSON.stringify(record)).not.toContain("exposed-value");
        expect(JSON.stringify(record)).not.toContain(".env.production");
    });
});
