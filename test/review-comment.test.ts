import { describe, expect, it } from "vitest";
import { createReviewCommentId } from "../src/domain/review/review-comment.js";
import { createSummaryReviewComment } from "../src/application/create-summary-review-comment.js";

describe("summary review comment protocol", () => {
    it("creates a stable marker that a platform adapter can update", () => {
        const reviewId = createReviewCommentId("codeup", "group/repository", "42");
        const comment = createSummaryReviewComment(reviewId, "## AI Code Review\n\nSafe report");

        expect(comment).toEqual({
            type: "summary",
            reviewId: "codeup:group/repository:42",
            body: "<!-- ai-code-review:review-id=codeup:group/repository:42 -->\n\n## AI Code Review\n\nSafe report",
        });
    });

    it("rejects values that could break the hidden marker", () => {
        expect(() => createReviewCommentId("codeup", "repository", "42-->"))
            .toThrow("Review comment identifier is invalid.");
    });
});
