import { describe, expect, it, vi } from "vitest";
import { recordReviewRunUseCase } from "../../../../src/application/review/recording/record-review-run-use-case.js";

const record = {
    schemaVersion: "v1" as const,
    runId: "run-123",
    recordedAt: "2026-09-02T00:00:00.000Z",
    qualityGateFailed: false,
    highestSeverity: null,
    analyzerRuns: [],
    findings: [],
};

describe("recordReviewRunUseCase", () => {
    it("returns a safe delivery status when persistence succeeds or fails", async () => {
        await expect(recordReviewRunUseCase(record, { append: vi.fn().mockResolvedValue(undefined) }))
            .resolves.toBe("delivered");
        await expect(recordReviewRunUseCase(record, { append: vi.fn().mockRejectedValue(new Error("path=C:/secret")) }))
            .resolves.toBe("failed");
    });
});
