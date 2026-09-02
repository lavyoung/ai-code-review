import {describe, expect, it, vi} from "vitest";
import {CompositeReviewQualityStore} from "../../../src/infrastructure/recording/composite-review-quality-store.js";

const reviewRunRecord = {
    schemaVersion: "v1" as const,
    recordType: "review-run" as const,
    runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
    recordedAt: "2026-09-02T00:00:00.000Z",
    qualityGateFailed: false,
    highestSeverity: null,
    analyzerRuns: [],
    findings: [],
};

describe("CompositeReviewQualityStore", () => {
    it("writes the same sanitized event to every configured store", async () => {
        const local = {append: vi.fn().mockResolvedValue(undefined), appendFeedback: vi.fn()};
        const remote = {append: vi.fn().mockResolvedValue(undefined), appendFeedback: vi.fn()};

        await new CompositeReviewQualityStore([local, remote]).append(reviewRunRecord);

        expect(local.append).toHaveBeenCalledWith(reviewRunRecord);
        expect(remote.append).toHaveBeenCalledWith(reviewRunRecord);
    });

    it("does not hide a failed destination", async () => {
        const failed = {append: vi.fn().mockRejectedValue(new Error("network")), appendFeedback: vi.fn()};

        await expect(new CompositeReviewQualityStore([failed]).append(reviewRunRecord))
            .rejects.toThrow("network");
    });
});
