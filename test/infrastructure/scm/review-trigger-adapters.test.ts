import {describe, expect, it} from "vitest";
import {ReviewTriggerContextError} from "../../../src/application/review/errors/review-trigger-error.js";
import {
    CodeUpMergeRequestReviewTriggerAdapter
} from "../../../src/infrastructure/scm/codeup/codeup-merge-request-review-trigger-adapter.js";
import {
    LocalManualReviewTriggerAdapter
} from "../../../src/infrastructure/scm/git/local-manual-review-trigger-adapter.js";
import {
    GitHubPullRequestReviewTriggerAdapter
} from "../../../src/infrastructure/scm/github/github-pull-request-review-trigger-adapter.js";
import {
    GitHubActionsContextError
} from "../../../src/infrastructure/scm/github/resolve-github-actions-pull-request-context.js";

describe("review trigger adapters", () => {
    it("converts a local manual target into a platform-neutral committed range", async () => {
        await expect(new LocalManualReviewTriggerAdapter().resolve({target: "main"})).resolves.toEqual({
            kind: "review",
            invocation: expect.objectContaining({
                providerId: "local",
                event: "manual",
                range: {baseRef: "main", headRef: "HEAD", comparison: "three-dot"},
                reportTarget: "main",
            }),
        });
    });

    it("rejects a manual invocation without a committed target", async () => {
        await expect(new LocalManualReviewTriggerAdapter().resolve({})).rejects.toBeInstanceOf(
            ReviewTriggerContextError,
        );
    });

    it("maps GitHub PR context to the shared range contract", async () => {
        const adapter = new GitHubPullRequestReviewTriggerAdapter({
            environment: {},
            commentEnabled: false,
            commentFailOnError: false,
        }, async () => ({
            pullRequestNumber: "42",
            repository: "owner/repository",
            repositoryOwner: "owner",
            repositoryName: "repository",
            baseRef: "main",
            baseSha: "base-sha",
            headRef: "feature",
            headSha: "head-sha",
        }));

        await expect(adapter.resolve({})).resolves.toEqual({
            kind: "review",
            invocation: expect.objectContaining({
                providerId: "github",
                event: "pull-request",
                range: {baseRef: "base-sha", headRef: "head-sha", comparison: "three-dot"},
                reportTarget: "main",
                summaryComment: {
                    label: "GitHub PR comment",
                    enabled: false,
                    failOnError: false,
                },
            }),
        });
    });

    it("maps platform context validation errors without exposing event payloads", async () => {
        const adapter = new GitHubPullRequestReviewTriggerAdapter({
            environment: {},
            commentEnabled: false,
            commentFailOnError: false,
        }, async () => {
            throw new GitHubActionsContextError("payload was invalid");
        });

        await expect(adapter.resolve({})).rejects.toMatchObject({
            name: ReviewTriggerContextError.name,
            providerId: "github",
            event: "pull-request",
        });
    });

    it("maps CodeUp MR context to the shared range contract", async () => {
        const adapter = new CodeUpMergeRequestReviewTriggerAdapter({
            environment: {},
            commentEnabled: false,
            commentFailOnError: false,
            accessToken: "test-token",
        }, async () => ({
            baseSha: "base-sha",
            headSha: "head-sha",
            targetRef: "main",
            repositoryId: "repository-id",
            changeRequestId: "11",
            patchSetBizId: "patch-set",
            apiBaseUrl: "https://codeup.example.test",
        }));

        await expect(adapter.resolve({})).resolves.toEqual({
            kind: "review",
            invocation: expect.objectContaining({
                providerId: "codeup",
                event: "merge-request",
                range: {baseRef: "base-sha", headRef: "head-sha", comparison: "three-dot"},
                reportTarget: "main",
                summaryComment: {
                    label: "CodeUp MR comment",
                    enabled: false,
                    failOnError: false,
                },
            }),
        });
    });
});
