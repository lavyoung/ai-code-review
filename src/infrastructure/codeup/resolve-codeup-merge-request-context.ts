import { z } from "zod";

const optionalNonEmptyString = z.string().trim().min(1).optional();

/** 已验证的 CodeUp Flow 合并请求上下文。 */
export interface CodeUpMergeRequestContext {
    baseSha: string;
    headSha: string;
    targetRef: string;
    repositoryId?: string;
    changeRequestId?: string;
    patchSetBizId?: string;
    apiBaseUrl?: string;
    organizationId?: string;
}

/** CodeUp Flow 自定义变量不完整或不合法时抛出的安全错误。 */
export class CodeUpMergeRequestContextError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "CodeUpMergeRequestContextError";
    }
}

/**
 * 从明确约定的 Flow 自定义变量读取 CodeUp MR 的已提交评审范围。
 *
 * Flow 官方未定义 MR 元数据的内置变量，因此不得推测分支、`HEAD` 或提交范围。
 */
export const resolveCodeUpMergeRequestContext = (
    environment: NodeJS.ProcessEnv,
): CodeUpMergeRequestContext => {
    try {
        const baseSha = z.string().trim().min(1).parse(environment.AICR_CODEUP_BASE_SHA);
        const headSha = z.string().trim().min(1).parse(environment.AICR_CODEUP_HEAD_SHA);
        const targetRef = z.string().trim().min(1).parse(environment.AICR_CODEUP_TARGET_REF);
        const apiBaseUrl = z.string().url().optional().parse(environment.AICR_CODEUP_API_BASE_URL);

        return {
            baseSha,
            headSha,
            targetRef,
            ...(optionalNonEmptyString.parse(environment.AICR_CODEUP_REPOSITORY_ID) === undefined
                ? {}
                : { repositoryId: optionalNonEmptyString.parse(environment.AICR_CODEUP_REPOSITORY_ID)! }),
            ...(optionalNonEmptyString.parse(environment.AICR_CODEUP_MR_ID) === undefined
                ? {}
                : { changeRequestId: optionalNonEmptyString.parse(environment.AICR_CODEUP_MR_ID)! }),
            ...(optionalNonEmptyString.parse(environment.AICR_CODEUP_PATCHSET_BIZ_ID) === undefined
                ? {}
                : { patchSetBizId: optionalNonEmptyString.parse(environment.AICR_CODEUP_PATCHSET_BIZ_ID)! }),
            ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
            ...(optionalNonEmptyString.parse(environment.AICR_CODEUP_ORGANIZATION_ID) === undefined
                ? {}
                : { organizationId: optionalNonEmptyString.parse(environment.AICR_CODEUP_ORGANIZATION_ID)! }),
        };
    } catch {
        throw new CodeUpMergeRequestContextError("CodeUp merge request context was invalid.");
    }
};
