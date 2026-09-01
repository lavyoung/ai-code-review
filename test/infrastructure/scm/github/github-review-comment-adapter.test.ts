import { describe, expect, it, vi } from "vitest";
import { GitHubReviewCommentAdapter } from "../../../../src/infrastructure/scm/github/github-review-comment-adapter.js";

const configuration = {
    apiBaseUrl: "https://github.example.test/api/v3/",
    owner: "octo-org",
    repository: "example-repository",
    pullRequestNumber: "42",
    accessToken: "test-token",
};

const comment = {
    type: "summary" as const,
    reviewId: "github:octo-org/example-repository:42",
    body: "<!-- ai-code-review:review-id=github:octo-org/example-repository:42 -->\n\n## AI Code Review",
};

describe("GitHubReviewCommentAdapter", () => {
    it("creates an issue-style PR comment when no matching marker exists", async () => {
        const send = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
            .mockResolvedValueOnce(new Response("{}", { status: 201 }));
        const adapter = new GitHubReviewCommentAdapter(configuration, send);

        await adapter.upsertSummary(comment);

        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenNthCalledWith(1,
            "https://github.example.test/api/v3/repos/octo-org/example-repository/issues/42/comments?per_page=100&page=1",
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                    "X-GitHub-Api-Version": "2026-03-10",
                }),
            }),
        );
        expect(send).toHaveBeenNthCalledWith(2,
            "https://github.example.test/api/v3/repos/octo-org/example-repository/issues/42/comments",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ body: comment.body }),
            }),
        );
    });

    it("updates a matching comment found on a later page", async () => {
        const firstPage = Array.from({ length: 100 }, (_, id) => ({
            id,
            body: "Unrelated comment",
        }));
        const send = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 101, body: comment.body }]), { status: 200 }))
            .mockResolvedValueOnce(new Response("{}", { status: 200 }));
        const adapter = new GitHubReviewCommentAdapter(configuration, send);

        await adapter.upsertSummary(comment);

        expect(send).toHaveBeenCalledTimes(3);
        expect(send).toHaveBeenNthCalledWith(2,
            "https://github.example.test/api/v3/repos/octo-org/example-repository/issues/42/comments?per_page=100&page=2",
            expect.objectContaining({ method: "GET" }),
        );
        expect(send).toHaveBeenLastCalledWith(
            "https://github.example.test/api/v3/repos/octo-org/example-repository/issues/comments/101",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({ body: comment.body }),
            }),
        );
    });

    it("rejects a failed GitHub request without exposing sensitive configuration", async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("failure", { status: 401 }));
        const adapter = new GitHubReviewCommentAdapter(configuration, send);

        await expect(adapter.upsertSummary(comment))
            .rejects.toThrow("GitHub review comment request failed.");
    });
});
