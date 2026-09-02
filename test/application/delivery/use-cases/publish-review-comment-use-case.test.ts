import { describe, expect, it, vi } from "vitest";
import { publishReviewCommentUseCase } from "../../../../src/application/delivery/use-cases/publish-review-comment-use-case.js";

const comment = {
    type: "summary" as const,
    reviewId: "codeup:repository:42",
    body: "<!-- ai-code-review:review-id=codeup:repository:42 -->\n\nreport",
};

describe("publishReviewCommentUseCase", () => {
    it("delegates idempotent publication to the platform port", async () => {
        const upsertSummary = vi.fn().mockResolvedValue(undefined);

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "delivered", attempts: 1 });
        expect(upsertSummary).toHaveBeenCalledWith(comment);
    });

    it("retries transient publication failures before succeeding", async () => {
        const upsertSummary = vi.fn()
            .mockRejectedValueOnce(new Error("token=secret"))
            .mockRejectedValueOnce(new Error("token=secret"))
            .mockResolvedValue(undefined);

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "delivered", attempts: 3 });
        expect(upsertSummary).toHaveBeenCalledTimes(3);
    });

    it("returns a safe final failure status after all retries", async () => {
        const upsertSummary = vi.fn().mockRejectedValue(new Error("token=secret"));

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "failed", attempts: 3 });
        expect(upsertSummary).toHaveBeenCalledTimes(3);
    });

    it("does not retry when the platform deliberately skips publication", async () => {
        const upsertSummary = vi.fn().mockResolvedValue("skipped");

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "skipped", attempts: 1 });
        expect(upsertSummary).toHaveBeenCalledTimes(1);
    });
});
