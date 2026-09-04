import {describe, expect, it, vi} from "vitest";
import {
    GitHubActionsPushContextError,
    isDeletedBranchPush,
    isInitialPush,
    isTagPush,
    resolveGitHubActionsPushContext,
} from "../../../../src/infrastructure/scm/github/resolve-github-actions-push-context.js";

const sha = (character: string): string => character.repeat(40);
const environment = {GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/runner/event.json"};

describe("resolveGitHubActionsPushContext", () => {
    it("extracts a committed branch two-dot range without exposing its payload", async () => {
        const context = await resolveGitHubActionsPushContext(environment, vi.fn().mockResolvedValue(JSON.stringify({
            ref: "refs/heads/main",
            before: sha("a"),
            after: sha("b"),
            repository: {full_name: "octo-org/example"},
        })));

        expect(context).toEqual({
            repository: "octo-org/example",
            branch: "refs/heads/main",
            beforeSha: sha("a"),
            afterSha: sha("b"),
            deleted: false,
        });
        expect(isInitialPush(context)).toBe(false);
        expect(isDeletedBranchPush(context)).toBe(false);
        expect(isTagPush(context)).toBe(false);
    });

    it("identifies legal non-review push cases", async () => {
        const tag = await resolveGitHubActionsPushContext(environment, vi.fn().mockResolvedValue(JSON.stringify({
            ref: "refs/tags/v1.0.0",
            before: sha("a"), after: sha("b"), repository: {full_name: "octo-org/example"},
        })));
        const initial = await resolveGitHubActionsPushContext(environment, vi.fn().mockResolvedValue(JSON.stringify({
            ref: "refs/heads/main",
            before: sha("0"), after: sha("b"), repository: {full_name: "octo-org/example"},
        })));
        const deleted = await resolveGitHubActionsPushContext(environment, vi.fn().mockResolvedValue(JSON.stringify({
            ref: "refs/heads/main",
            before: sha("a"), after: sha("0"), deleted: true, repository: {full_name: "octo-org/example"},
        })));

        expect(isTagPush(tag)).toBe(true);
        expect(isInitialPush(initial)).toBe(true);
        expect(isDeletedBranchPush(deleted)).toBe(true);
    });

    it("rejects non-push events, malformed SHAs, and invalid refs", async () => {
        await expect(resolveGitHubActionsPushContext({...environment, GITHUB_EVENT_NAME: "pull_request"}, vi.fn()))
            .rejects.toBeInstanceOf(GitHubActionsPushContextError);
        await expect(resolveGitHubActionsPushContext(environment, vi.fn().mockResolvedValue(JSON.stringify({
            ref: "refs/pull/1/head", before: "not-a-sha", after: sha("b"), repository: {full_name: "octo-org/example"},
        })))).rejects.toBeInstanceOf(GitHubActionsPushContextError);
    });
});
