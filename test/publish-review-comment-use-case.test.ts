import { describe, expect, it, vi } from "vitest";
import { publishReviewCommentUseCase } from "../src/application/publish-review-comment-use-case.js";

const comment = {
    type: "summary" as const,
    reviewId: "codeup:repository:42",
    body: "<!-- ai-code-review:review-id=codeup:repository:42 -->\n\nreport",
};

describe("publishReviewCommentUseCase", () => {
    it("delegates idempotent publication to the platform port", async () => {
        const upsertSummary = vi.fn().mockResolvedValue(undefined);

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "delivered" });
        expect(upsertSummary).toHaveBeenCalledWith(comment);
    });

    it("returns a safe failure status without exposing adapter details", async () => {
        const upsertSummary = vi.fn().mockRejectedValue(new Error("token=secret"));

        await expect(publishReviewCommentUseCase(comment, { upsertSummary }))
            .resolves.toEqual({ status: "failed" });
    });
});
