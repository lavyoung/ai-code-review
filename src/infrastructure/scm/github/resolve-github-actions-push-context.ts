import {readFile} from "node:fs/promises";
import {z} from "zod";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const ZERO_SHA = "0".repeat(40);

const pushEventSchema = z.object({
    ref: z.string().trim().min(1),
    before: z.string().trim(),
    after: z.string().trim(),
    deleted: z.boolean().optional(),
    repository: z.object({
        full_name: z.string().trim().regex(/^[^/]+\/[^/]+$/),
    }).passthrough(),
}).passthrough();

export type GitHubPushEventPayloadReader = (path: string) => Promise<string>;

/** 经事件校验的 GitHub 分支 Push 上下文；不包含原始负载或凭据。 */
export interface GitHubActionsPushContext {
    repository: string;
    branch: string;
    beforeSha: string;
    afterSha: string;
    deleted: boolean;
}

/** Push 事件不符合受控提交范围条件时抛出的安全错误。 */
export class GitHubActionsPushContextError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "GitHubActionsPushContextError";
    }
}

/**
 * 从 GitHub Actions Push 事件读取精确提交范围。
 *
 * Tag、删除分支和首次推送由 Trigger Adapter 转换为成功跳过；这里仍验证其余
 * 事件字段，避免将不完整 payload 当作一个空 diff。
 */
export const resolveGitHubActionsPushContext = async (
    environment: NodeJS.ProcessEnv,
    readPayload: GitHubPushEventPayloadReader = (path) => readFile(path, "utf8"),
): Promise<GitHubActionsPushContext> => {
    if (environment.GITHUB_EVENT_NAME !== "push") {
        throw new GitHubActionsPushContextError("GitHub Actions event must be push.");
    }
    const eventPath = environment.GITHUB_EVENT_PATH?.trim();
    if (eventPath === undefined || eventPath.length === 0) {
        throw new GitHubActionsPushContextError("GitHub Actions event payload is unavailable.");
    }

    let event: z.infer<typeof pushEventSchema>;
    try {
        event = pushEventSchema.parse(JSON.parse(await readPayload(eventPath)));
    } catch {
        throw new GitHubActionsPushContextError("GitHub Actions push payload was invalid.");
    }

    if (!event.ref.startsWith("refs/heads/") && !event.ref.startsWith("refs/tags/")) {
        throw new GitHubActionsPushContextError("GitHub Actions push ref was invalid.");
    }
    if (!SHA_PATTERN.test(event.before) || !SHA_PATTERN.test(event.after)) {
        throw new GitHubActionsPushContextError("GitHub Actions push commit range was invalid.");
    }

    return {
        repository: event.repository.full_name,
        branch: event.ref,
        beforeSha: event.before.toLowerCase(),
        afterSha: event.after.toLowerCase(),
        deleted: event.deleted ?? false,
    };
};

export const isInitialPush = (context: GitHubActionsPushContext): boolean => context.beforeSha === ZERO_SHA;

export const isDeletedBranchPush = (
    context: GitHubActionsPushContext,
): boolean => context.afterSha === ZERO_SHA || context.deleted;

export const isTagPush = (context: GitHubActionsPushContext): boolean => context.branch.startsWith("refs/tags/");
