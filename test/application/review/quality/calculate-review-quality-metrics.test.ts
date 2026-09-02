import { describe, expect, it } from "vitest";
import { calculateReviewQualityMetrics } from "../../../../src/application/review/quality/calculate-review-quality-metrics.js";

describe("calculateReviewQualityMetrics", () => {
    it("uses only the latest matching feedback for rates and keeps source data out of metrics", () => {
        const metrics = calculateReviewQualityMetrics([
            {
                schemaVersion: "v1",
                recordType: "review-run",
                runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
                recordedAt: "2026-09-02T00:00:00.000Z",
                qualityGateFailed: true,
                highestSeverity: "high",
                analyzerRuns: [
                    { analyzerId: "semantic:deepseek", status: "completed", attempts: 2, durationMs: 10 },
                    { analyzerId: "typecheck:typescript", status: "failed", attempts: 1, durationMs: 20 },
                ],
                findings: [
                    { fingerprint: "0123456789abcdef01234567", severity: "high", verificationStatus: "verified", analyzerIds: ["semantic:deepseek"] },
                    { fingerprint: "fedcba9876543210fedcba98", severity: "medium", verificationStatus: "grounded", analyzerIds: ["semantic:deepseek"] },
                ],
            },
            {
                schemaVersion: "v1",
                recordType: "finding-feedback",
                feedbackId: "40e4c6ec-8be2-4de2-9d5e-54cda88a3cf0",
                fingerprint: "0123456789abcdef01234567",
                status: "false-positive",
                recordedAt: "2026-09-02T00:00:01.000Z",
                runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
            },
            {
                schemaVersion: "v1",
                recordType: "finding-feedback",
                feedbackId: "cc209953-0871-43a1-a734-fa146a94282f",
                fingerprint: "0123456789abcdef01234567",
                status: "accepted",
                recordedAt: "2026-09-02T00:00:02.000Z",
            },
            {
                schemaVersion: "v1",
                recordType: "finding-feedback",
                feedbackId: "1f9c4b7b-17b9-48c5-99f1-83bf95bb19d7",
                fingerprint: "fedcba9876543210fedcba98",
                status: "false-positive",
                recordedAt: "2026-09-02T00:00:03.000Z",
            },
            {
                schemaVersion: "v1",
                recordType: "finding-feedback",
                feedbackId: "4eb2aaf5-81e0-4539-87d8-fd0972ded710",
                fingerprint: "111111111111111111111111",
                status: "fixed",
                recordedAt: "2026-09-02T00:00:04.000Z",
            },
        ]);

        expect(metrics).toEqual({
            schemaVersion: "v1",
            recordType: "review-quality-metrics",
            runCount: 1,
            qualityGateFailureCount: 1,
            findingCount: 2,
            uniqueFindingCount: 2,
            feedbackEventCount: 4,
            latestFeedbackCounts: {
                accepted: 1,
                "false-positive": 1,
                "not-applicable": 0,
                fixed: 0,
            },
            matchedFeedbackEventCount: 3,
            unmatchedFeedbackEventCount: 1,
            feedbackCoveragePercent: 100,
            falsePositiveRatePercent: 50,
            averageFeedbackResolutionMs: 1000,
            analyzers: [
                {
                    analyzerId: "semantic:deepseek",
                    completedCount: 1,
                    degradedCount: 0,
                    failedCount: 0,
                    totalAttemptCount: 2,
                    averageAttemptCount: 2,
                    averageDurationMs: 10,
                },
                {
                    analyzerId: "typecheck:typescript",
                    completedCount: 0,
                    degradedCount: 0,
                    failedCount: 1,
                    totalAttemptCount: 1,
                    averageAttemptCount: 1,
                    averageDurationMs: 20,
                },
            ],
        });
        expect(JSON.stringify(metrics)).not.toContain(".env");
        expect(JSON.stringify(metrics)).not.toContain("token=");
    });
});
