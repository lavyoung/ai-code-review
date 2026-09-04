import {describe, expect, it} from "vitest";
import {ChangedContractCatalog} from "../../../src/infrastructure/impact/changed-contract-catalog.js";

const codeChange = {
    diff: "",
    files: [{path: "contracts/openapi.yaml", status: "modified" as const}, {
        path: "docs/example-openapi.yaml", status: "modified" as const}],
    chunks: [{
        id: "openapi-chunk",
        path: "contracts/openapi.yaml",
        newRange: {startLine: 3, endLine: 3},
        content: "@@ -2,0 +3 @@\n+  /health:\n",
    }, {
        id: "documentation-chunk",
        path: "docs/example-openapi.yaml",
        newRange: {startLine: 1, endLine: 1},
        content: "@@ -0,0 +1 @@\n+example: only\n",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("ChangedContractCatalog", () => {
    it("anchors a changed OpenAPI definition but ignores similarly named documentation", async () => {
        const result = await new ChangedContractCatalog().analyze({
            fileChanges: [{
                file: {path: "contracts/openapi.yaml", status: "modified"},
                diff: "@@ -2,0 +3 @@\n+  /health:\n",
            }, {
                file: {path: "docs/example-openapi.yaml", status: "modified"},
                diff: "@@ -0,0 +1 @@\n+example: only\n",
            }],
        }, codeChange, AbortSignal.timeout(1_000));

        expect(result).toEqual({
            relations: [expect.objectContaining({
                changeAnchorId: "openapi-chunk",
                sourceLine: 3,
                target: "openapi",
                kind: "contract-definition",
                completeness: "partial",
            })],
            limitations: [],
        });
    });
});
