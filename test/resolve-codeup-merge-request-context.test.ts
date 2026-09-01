import { describe, expect, it, vi } from "vitest";
import {
    CodeUpMergeRequestContextError,
    resolveCodeUpMergeRequestContext,
} from "../src/infrastructure/codeup/resolve-codeup-merge-request-context.js";

const environment = {
    AICR_CODEUP_API_BASE_URL: "https://codeup.example.test",
    AICR_CODEUP_REPOSITORY_ID: "group/repository",
    AICR_CODEUP_ORGANIZATION_ID: "organization-1",
    CODEUP_TOKEN: "test-token",
    CI_COMMIT_REF_NAME: "feature/review",
    CI_COMMIT_SHA: "head-sha",
};

describe("resolveCodeUpMergeRequestContext", () => {
    it("finds the unique open MR and derives its committed source and target versions", async () => {
        const send = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([{
                localId: 42,
                sourceBranch: "feature/review",
                targetBranch: "main",
            }]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                {
                    commitId: "base-sha",
                    patchSetBizId: "target-patch",
                    relatedMergeItemType: "MERGE_TARGET",
                    versionNo: 2,
                },
                {
                    commitId: "old-base-sha",
                    patchSetBizId: "old-target-patch",
                    relatedMergeItemType: "MERGE_TARGET",
                    versionNo: 1,
                },
                {
                    commitId: "head-sha",
                    patchSetBizId: "source-patch",
                    relatedMergeItemType: "MERGE_SOURCE",
                    versionNo: 3,
                },
                {
                    commitId: "old-head-sha",
                    patchSetBizId: "old-source-patch",
                    relatedMergeItemType: "MERGE_SOURCE",
                    versionNo: 2,
                },
            ]), { status: 200 }));

        await expect(resolveCodeUpMergeRequestContext(environment, send)).resolves.toEqual({
            baseSha: "base-sha",
            headSha: "head-sha",
            targetRef: "main",
            repositoryId: "group/repository",
            changeRequestId: "42",
            patchSetBizId: "source-patch",
            apiBaseUrl: "https://codeup.example.test",
            organizationId: "organization-1",
        });
        expect(send).toHaveBeenNthCalledWith(1,
            "https://codeup.example.test/oapi/v1/codeup/organizations/organization-1/changeRequests?projectIds=group%2Frepository&state=opened&perPage=100&page=1",
            expect.objectContaining({
                headers: expect.objectContaining({ "x-yunxiao-token": "test-token" }),
            }),
        );
        expect(send).toHaveBeenNthCalledWith(2,
            "https://codeup.example.test/oapi/v1/codeup/organizations/organization-1/repositories/group%2Frepository/changeRequests/42/diffs/patches",
            expect.anything(),
        );
    });

    it("rejects an ambiguous branch match or a source SHA that is not an MR source patch", async () => {
        const ambiguous = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
            { localId: 1, sourceBranch: "feature/review", targetBranch: "main" },
            { localId: 2, sourceBranch: "feature/review", targetBranch: "release" },
        ]), { status: 200 }));
        await expect(resolveCodeUpMergeRequestContext(environment, ambiguous))
            .rejects.toBeInstanceOf(CodeUpMergeRequestContextError);

        const mismatchedSource = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { localId: 1, sourceBranch: "feature/review", targetBranch: "main" },
            ]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { commitId: "other-sha", patchSetBizId: "source", relatedMergeItemType: "MERGE_SOURCE" },
                { commitId: "base-sha", patchSetBizId: "target", relatedMergeItemType: "MERGE_TARGET" },
            ]), { status: 200 }));
        await expect(resolveCodeUpMergeRequestContext(environment, mismatchedSource))
            .rejects.toBeInstanceOf(CodeUpMergeRequestContextError);
    });
});
