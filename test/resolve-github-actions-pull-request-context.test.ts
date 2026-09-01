import { describe, expect, it, vi } from "vitest";
import {
    GitHubActionsContextError,
    resolveGitHubActionsPullRequestContext,
} from "../src/infrastructure/github/resolve-github-actions-pull-request-context.js";

const environment = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: "/runner/event.json",
};

const eventPayload = JSON.stringify({
    number: 42,
    repository: { full_name: "octo-org/example-repository" },
    pull_request: {
        base: { ref: "main", sha: "base-sha" },
        head: { ref: "feature/review", sha: "head-sha" },
    },
});

describe("resolveGitHubActionsPullRequestContext", () => {
    it("extracts only the PR range and repository metadata from the event payload", async () => {
        const readPayload = vi.fn().mockResolvedValue(eventPayload);

        await expect(resolveGitHubActionsPullRequestContext(environment, readPayload))
            .resolves.toEqual({
                pullRequestNumber: "42",
                repository: "octo-org/example-repository",
                baseRef: "main",
                baseSha: "base-sha",
                headRef: "feature/review",
                headSha: "head-sha",
            });
        expect(readPayload).toHaveBeenCalledWith("/runner/event.json");
    });

    it("rejects unsupported or malformed GitHub Actions events", async () => {
        await expect(resolveGitHubActionsPullRequestContext(
            { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/runner/event.json" },
            vi.fn(),
        )).rejects.toBeInstanceOf(GitHubActionsContextError);

        await expect(resolveGitHubActionsPullRequestContext(
            environment,
            vi.fn().mockResolvedValue("not-json"),
        )).rejects.toBeInstanceOf(GitHubActionsContextError);
    });
});
