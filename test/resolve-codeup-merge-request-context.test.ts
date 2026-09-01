import { describe, expect, it } from "vitest";
import {
    CodeUpMergeRequestContextError,
    resolveCodeUpMergeRequestContext,
} from "../src/infrastructure/codeup/resolve-codeup-merge-request-context.js";

describe("resolveCodeUpMergeRequestContext", () => {
    it("reads the explicit CodeUp Flow MR range contract", () => {
        expect(resolveCodeUpMergeRequestContext({
            AICR_CODEUP_BASE_SHA: "base-sha",
            AICR_CODEUP_HEAD_SHA: "head-sha",
            AICR_CODEUP_TARGET_REF: "main",
            AICR_CODEUP_REPOSITORY_ID: "group/repository",
            AICR_CODEUP_MR_ID: "42",
            AICR_CODEUP_PATCHSET_BIZ_ID: "patch-set-1",
            AICR_CODEUP_API_BASE_URL: "https://codeup.example.test",
            AICR_CODEUP_ORGANIZATION_ID: "organization-1",
        })).toEqual({
            baseSha: "base-sha",
            headSha: "head-sha",
            targetRef: "main",
            repositoryId: "group/repository",
            changeRequestId: "42",
            patchSetBizId: "patch-set-1",
            apiBaseUrl: "https://codeup.example.test",
            organizationId: "organization-1",
        });
    });

    it("rejects an incomplete or invalid MR range", () => {
        expect(() => resolveCodeUpMergeRequestContext({
            AICR_CODEUP_HEAD_SHA: "head-sha",
            AICR_CODEUP_TARGET_REF: "main",
        })).toThrow(CodeUpMergeRequestContextError);
    });
});
