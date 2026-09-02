import { describe, expect, it, vi } from "vitest";
import { CodeUpReviewCommentAdapter } from "../../../../src/infrastructure/scm/codeup/codeup-review-comment-adapter.js";

const configuration = {
    apiBaseUrl: "https://codeup.example.test",
    accessToken: "test-token",
    repositoryId: "group/repository",
    changeRequestId: "42",
    patchSetBizId: "patch-set-1",
};

const comment = {
    type: "summary" as const,
    reviewId: "codeup:group/repository:42",
    body: "<!-- ai-code-review:review-id=codeup:group/repository:42 -->\n\n## AI Code Review",
};

describe("CodeUpReviewCommentAdapter", () => {
    it("creates an MR global comment when no matching marker exists", async () => {
        const send = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
            .mockResolvedValueOnce(new Response("{}", { status: 200 }));
        const adapter = new CodeUpReviewCommentAdapter(configuration, send);

        await adapter.upsertSummary(comment);

        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenNthCalledWith(1,
            "https://codeup.example.test/oapi/v1/codeup/repositories/group%2Frepository/changeRequests/42/comments/list",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ "x-yunxiao-token": "test-token" }),
                body: JSON.stringify({ comment_type: "GLOBAL_COMMENT", state: "OPENED" }),
            }),
        );
        expect(send).toHaveBeenNthCalledWith(2,
            "https://codeup.example.test/oapi/v1/codeup/repositories/group%2Frepository/changeRequests/42/comments",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    comment_type: "GLOBAL_COMMENT",
                    content: comment.body,
                    draft: false,
                    patchset_biz_id: "patch-set-1",
                    resolved: false,
                }),
            }),
        );
    });

    it("updates the existing global comment that contains the marker", async () => {
        const send = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([{
                comment_biz_id: "comment-1",
                comment_type: "GLOBAL_COMMENT",
                content: comment.body,
            }]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ result: true }), { status: 200 }));
        const adapter = new CodeUpReviewCommentAdapter(configuration, send);

        await adapter.upsertSummary(comment);

        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(
            "https://codeup.example.test/oapi/v1/codeup/repositories/group%2Frepository/changeRequests/42/comments/comment-1",
            expect.objectContaining({
                method: "PUT",
                body: JSON.stringify({ content: comment.body, resolved: false }),
            }),
        );
    });

    it("rejects a failed CodeUp request without exposing sensitive configuration", async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("failure", { status: 500 }));
        const adapter = new CodeUpReviewCommentAdapter(configuration, send);

        await expect(adapter.upsertSummary(comment))
            .rejects.toThrow("CodeUp review comment request failed.");
    });
});
