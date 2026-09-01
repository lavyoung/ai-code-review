import { z } from "zod";

interface CodeUpChangeRequest {
    localId?: unknown;
    sourceBranch?: unknown;
    targetBranch?: unknown;
}

interface CodeUpPatchSet {
    commitId?: unknown;
    patchSetBizId?: unknown;
    relatedMergeItemType?: unknown;
    versionNo?: unknown;
}

/** 由 CodeUp MR API 自动解析出的评审上下文。 */
export interface CodeUpMergeRequestContext {
    baseSha: string;
    headSha: string;
    targetRef: string;
    repositoryId: string;
    changeRequestId: string;
    patchSetBizId: string;
    apiBaseUrl: string;
    organizationId?: string;
}

/** CodeUp Flow 环境、MR 候选或 MR 版本不符合预期时抛出的安全错误。 */
export class CodeUpMergeRequestContextError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "CodeUpMergeRequestContextError";
    }
}

const toPathSegment = (value: string): string => encodeURIComponent(value);

const asChangeRequest = (value: unknown): CodeUpChangeRequest | undefined =>
    typeof value === "object" && value !== null ? value as CodeUpChangeRequest : undefined;

const asPatchSet = (value: unknown): CodeUpPatchSet | undefined =>
    typeof value === "object" && value !== null ? value as CodeUpPatchSet : undefined;

const compareVersion = (left: CodeUpPatchSet, right: CodeUpPatchSet): number =>
    (typeof right.versionNo === "number" ? right.versionNo : -1)
    - (typeof left.versionNo === "number" ? left.versionNo : -1);

/**
 * 使用 Flow 的当前源分支和提交，从 CodeUp API 自动定位唯一的打开 MR 及其最新版本。
 *
 * `CI_COMMIT_REF_NAME` 与 `CI_COMMIT_SHA` 是 Flow 公开的代码源变量；仓库与 API 信息
 * 由流水线静态配置提供。匹配不唯一或提交不对应 MR 源版本时，拒绝评审而不猜测。
 */
export const resolveCodeUpMergeRequestContext = async (
    environment: NodeJS.ProcessEnv,
    send: typeof fetch = fetch,
): Promise<CodeUpMergeRequestContext> => {
    let apiBaseUrl: string;
    let repositoryId: string;
    let accessToken: string;
    let sourceBranch: string;
    let sourceSha: string;
    let organizationId: string | undefined;

    try {
        apiBaseUrl = z.string().url().parse(environment.AICR_CODEUP_API_BASE_URL);
        repositoryId = z.string().trim().min(1).parse(environment.AICR_CODEUP_REPOSITORY_ID);
        accessToken = z.string().trim().min(1).parse(environment.CODEUP_TOKEN);
        sourceBranch = z.string().trim().min(1).parse(environment.CI_COMMIT_REF_NAME);
        sourceSha = z.string().trim().min(1).parse(environment.CI_COMMIT_SHA);
        organizationId = z.string().trim().min(1).optional().parse(
            environment.AICR_CODEUP_ORGANIZATION_ID,
        );
    } catch {
        throw new CodeUpMergeRequestContextError("CodeUp Flow configuration was invalid.");
    }

    const root = organizationId === undefined
        ? "/oapi/v1/codeup"
        : `/oapi/v1/codeup/organizations/${toPathSegment(organizationId)}`;
    const request = async (path: string): Promise<Response> => {
        const response = await send(new URL(path, apiBaseUrl).toString(), {
            headers: {
                "Content-Type": "application/json",
                "x-yunxiao-token": accessToken,
            },
        });

        if (!response.ok) {
            throw new CodeUpMergeRequestContextError("CodeUp merge request lookup failed.");
        }

        return response;
    };
    const readJson = async (response: Response): Promise<unknown> => {
        try {
            return await response.json();
        } catch {
            throw new CodeUpMergeRequestContextError("CodeUp merge request response was invalid.");
        }
    };

    const candidates: CodeUpChangeRequest[] = [];
    let page = 1;
    const visitedPages = new Set<number>();
    while (!visitedPages.has(page)) {
        visitedPages.add(page);
        const query = new URLSearchParams({
            projectIds: repositoryId,
            state: "opened",
            perPage: "100",
            page: String(page),
        });
        const response = await request(`${root}/changeRequests?${query}`);
        const payload = await readJson(response);
        if (!Array.isArray(payload)) {
            throw new CodeUpMergeRequestContextError("CodeUp merge request list was invalid.");
        }

        candidates.push(...payload.map(asChangeRequest).filter((value): value is CodeUpChangeRequest =>
            value !== undefined
            && value.sourceBranch === sourceBranch
            && (typeof value.localId === "number" || typeof value.localId === "string"),
        ));

        const nextPageValue = response.headers.get("x-next-page");
        if (nextPageValue === null || nextPageValue.trim() === "" || nextPageValue === "0") {
            break;
        }

        const nextPage = Number(nextPageValue);
        if (!Number.isInteger(nextPage) || nextPage < 1) {
            throw new CodeUpMergeRequestContextError("CodeUp merge request pagination was invalid.");
        }

        page = nextPage;
    }

    if (candidates.length !== 1) {
        throw new CodeUpMergeRequestContextError("CodeUp merge request match was not unique.");
    }

    const candidate = candidates[0]!;
    if ((typeof candidate.localId !== "number" && typeof candidate.localId !== "string")
        || typeof candidate.targetBranch !== "string" || candidate.targetBranch.length === 0) {
        throw new CodeUpMergeRequestContextError("CodeUp merge request metadata was invalid.");
    }

    const changeRequestId = String(candidate.localId);
    const patchPayload = await readJson(await request(
        `${root}/repositories/${toPathSegment(repositoryId)}/changeRequests/${toPathSegment(changeRequestId)}/diffs/patches`,
    ));
    if (!Array.isArray(patchPayload)) {
        throw new CodeUpMergeRequestContextError("CodeUp merge request versions were invalid.");
    }

    const patchSets = patchPayload.map(asPatchSet).filter((value): value is CodeUpPatchSet => value !== undefined);
    const sourcePatch = patchSets
        .filter((value) => value.relatedMergeItemType === "MERGE_SOURCE")
        .sort(compareVersion)[0];
    const targetPatch = patchSets
        .filter((value) => value.relatedMergeItemType === "MERGE_TARGET")
        .sort(compareVersion)[0];
    if (sourcePatch === undefined
        || sourcePatch.commitId !== sourceSha
        || !Number.isInteger(sourcePatch.versionNo)
        || typeof sourcePatch.patchSetBizId !== "string"
        || sourcePatch.patchSetBizId.length === 0
        || targetPatch === undefined
        || !Number.isInteger(targetPatch.versionNo)
        || typeof targetPatch.commitId !== "string"
        || targetPatch.commitId.length === 0) {
        throw new CodeUpMergeRequestContextError("CodeUp merge request versions did not match the Flow commit.");
    }

    return {
        baseSha: targetPatch.commitId,
        headSha: sourceSha,
        targetRef: candidate.targetBranch,
        repositoryId,
        changeRequestId,
        patchSetBizId: sourcePatch.patchSetBizId,
        apiBaseUrl,
        ...(organizationId === undefined ? {} : { organizationId }),
    };
};
