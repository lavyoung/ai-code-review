import {describe, expect, it} from "vitest";
import {ReviewTriggerContextError} from "../../../../src/application/review/errors/review-trigger-error.js";
import {
    GitHubPushReviewTriggerAdapter
} from "../../../../src/infrastructure/scm/github/github-push-review-trigger-adapter.js";

const sha = (character: string): string => character.repeat(40);
const context = {
    repository: "octo-org/example",
    branch: "refs/heads/main",
    beforeSha: sha("a"),
    afterSha: sha("b"),
    deleted: false,
};

describe("GitHubPushReviewTriggerAdapter", () => {
    it("creates a strict two-dot invocation only when HEAD matches after", async () => {
        const adapter = new GitHubPushReviewTriggerAdapter({}, async () => context, async () => sha("b"));

        await expect(adapter.resolve({})).resolves.toEqual({
            kind: "review",
            invocation: expect.objectContaining({
                providerId: "github",
                event: "push",
                range: {baseRef: sha("a"), headRef: sha("b"), comparison: "two-dot"},
                reportTarget: "main",
            }),
        });
    });

    it.each([
        [{...context, branch: "refs/tags/v1.0.0"}, "tag-push"],
        [{...context, beforeSha: sha("0")}, "initial-push"],
        [{...context, afterSha: sha("0"), deleted: true}, "branch-deleted"],
    ] as const)("skips a legal %s case", async (pushContext, reason) => {
        const adapter = new GitHubPushReviewTriggerAdapter({}, async () => pushContext);
        await expect(adapter.resolve({})).resolves.toEqual({kind: "skip", skip: {reason}});
    });

    it("rejects a checkout that does not match the event after SHA", async () => {
        const adapter = new GitHubPushReviewTriggerAdapter({}, async () => context, async () => sha("c"));
        await expect(adapter.resolve({})).rejects.toBeInstanceOf(ReviewTriggerContextError);
    });
});
