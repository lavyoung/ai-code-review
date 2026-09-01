import { readFile } from "node:fs/promises";
import { z } from "zod";

const pullRequestEventSchema = z.object({
    number: z.number().int().positive(),
    repository: z.object({
        full_name: z.string().trim().regex(/^[^/]+\/[^/]+$/),
    }).passthrough(),
    pull_request: z.object({
        base: z.object({
            ref: z.string().trim().min(1),
            sha: z.string().trim().min(1),
        }).passthrough(),
        head: z.object({
            ref: z.string().trim().min(1),
            sha: z.string().trim().min(1),
        }).passthrough(),
    }).passthrough(),
}).passthrough();

/** GitHub Actions 事件文件的可替换读取能力。 */
export type GitHubEventPayloadReader = (path: string) => Promise<string>;

/** 已校验的 GitHub Actions Pull Request 上下文。 */
export interface GitHubActionsPullRequestContext {
    pullRequestNumber: string;
    repository: string;
    repositoryOwner: string;
    repositoryName: string;
    baseRef: string;
    baseSha: string;
    headRef: string;
    headSha: string;
}

/** GitHub Actions 事件名、事件文件或 PR 负载不符合预期时抛出的安全错误。 */
export class GitHubActionsContextError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "GitHubActionsContextError";
    }
}

/**
 * 从 GitHub Actions 的事件文件读取 PR 范围。
 *
 * 只提取评审必需的公开 Git 元数据，不记录完整事件负载或文件路径。
 */
export const resolveGitHubActionsPullRequestContext = async (
    environment: NodeJS.ProcessEnv,
    readPayload: GitHubEventPayloadReader = (path) => readFile(path, "utf8"),
): Promise<GitHubActionsPullRequestContext> => {
    if (environment.GITHUB_EVENT_NAME !== "pull_request") {
        throw new GitHubActionsContextError("GitHub Actions event must be pull_request.");
    }

    const eventPath = environment.GITHUB_EVENT_PATH?.trim();
    if (eventPath === undefined || eventPath.length === 0) {
        throw new GitHubActionsContextError("GitHub Actions event payload is unavailable.");
    }

    let payload: unknown;
    try {
        payload = JSON.parse(await readPayload(eventPath));
    } catch {
        throw new GitHubActionsContextError("GitHub Actions event payload was invalid.");
    }

    let event: z.infer<typeof pullRequestEventSchema>;
    try {
        event = pullRequestEventSchema.parse(payload);
    } catch {
        throw new GitHubActionsContextError("GitHub Actions pull request payload was invalid.");
    }
    const [repositoryOwner, repositoryName] = event.repository.full_name.split("/");
    if (repositoryOwner === undefined || repositoryName === undefined) {
        throw new GitHubActionsContextError("GitHub Actions repository payload was invalid.");
    }

    return {
        pullRequestNumber: String(event.number),
        repository: event.repository.full_name,
        repositoryOwner,
        repositoryName,
        baseRef: event.pull_request.base.ref,
        baseSha: event.pull_request.base.sha,
        headRef: event.pull_request.head.ref,
        headSha: event.pull_request.head.sha,
    };
};
