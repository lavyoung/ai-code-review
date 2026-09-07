import {describe, expect, it} from "vitest";
import {ChangedContractCatalog} from "../../../src/infrastructure/impact/changed-contract-catalog.js";

const availableSource = (base: string | undefined, head: string | undefined) => ({
    read: async (_range: unknown, revision: "base" | "head", paths: readonly string[]) => ({
        status: "available" as const,
        documents: (revision === "base" ? base : head) === undefined ? [] : [{
            path: paths[0] as string,
            content: (revision === "base" ? base : head) as string,
        }],
    }),
});

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
        const result = await new ChangedContractCatalog(availableSource(
            "openapi: 3.1.0\npaths: {}\n",
            "openapi: 3.1.0\npaths:\n  /health:\n    get:\n      responses:\n        '200': {description: ok}\n",
        )).analyze({
            fileChanges: [{
                file: {path: "contracts/openapi.yaml", status: "modified"},
                diff: "@@ -2,0 +3 @@\n+  /health:\n",
            }, {
                file: {path: "docs/example-openapi.yaml", status: "modified"},
                diff: "@@ -0,0 +1 @@\n+example: only\n",
            }],
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
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

    it("adds a versioned breaking relation for a removed OpenAPI path", async () => {
        const base = "openapi: 3.1.0\npaths:\n  /users:\n    get:\n      responses:\n        '200': {description: ok}\n";
        const head = "openapi: 3.1.0\npaths: {}\n";
        const result = await new ChangedContractCatalog(availableSource(base, head)).analyze({
            fileChanges: [{
                file: {path: "contracts/openapi.yaml", status: "modified"},
                diff: "@@ -3,5 +3 @@\n-  /users:\n-    get:\n-      responses:\n-        '200': {description: ok}\n+{}\n",
            }],
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
        }, {
            ...codeChange,
            chunks: [{
                id: "openapi-removal",
                path: "contracts/openapi.yaml",
                oldRange: {startLine: 3, endLine: 6},
                newRange: {startLine: 3, endLine: 3},
                content: "@@ -3,5 +3 @@\n-  /users:\n+{}\n",
            }],
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toEqual([]);
        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "contract-breaking-change",
            completeness: "complete",
            contractChange: {
                rulesetVersion: "v1",
                classification: "breaking",
                strategy: "openapi-client-backward",
                rule: "openapi-path-removed",
            },
        }));
    });

    it("keeps an invalid contract change unclassified", async () => {
        const result = await new ChangedContractCatalog(availableSource(
            "openapi: 3.1.0\npaths: {}\n",
            "openapi: [invalid\n",
        )).analyze({
            fileChanges: [{file: {path: "contracts/openapi.yaml", status: "modified"}, diff: "@@ -1 +1 @@\n-openapi: 3.1.0\n+openapi: [invalid\n"}],
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
        }, {
            ...codeChange,
            chunks: [{id: "invalid-contract", path: "contracts/openapi.yaml", newRange: {startLine: 1, endLine: 1}, content: "@@ -1 +1 @@\n+openapi: [invalid\n"}],
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toContain("contract-diff-unavailable");
        expect(result.relations).toContainEqual(expect.objectContaining({kind: "contract-definition"}));
        expect(result.relations).not.toContainEqual(expect.objectContaining({kind: "contract-breaking-change"}));
    });

    it("classifies a deleted contract without exposing its document subject", async () => {
        const result = await new ChangedContractCatalog(availableSource(
            "openapi: 3.1.0\npaths:\n  /private/users:\n    get:\n      responses:\n        '200': {description: ok}\n",
            undefined,
        )).analyze({
            fileChanges: [{
                file: {path: "contracts/openapi.yaml", status: "deleted"},
                diff: "@@ -1,6 +0,0 @@\n-openapi: 3.1.0\n-paths:\n-  /private/users:\n",
            }],
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
        }, {
            ...codeChange,
            chunks: [{
                id: "deleted-contract",
                path: "contracts/openapi.yaml",
                oldRange: {startLine: 1, endLine: 6},
                content: "@@ -1,6 +0,0 @@\n-openapi: 3.1.0\n-paths:\n-  /private/users:\n",
            }],
        }, AbortSignal.timeout(1_000));

        const breakingRelation = result.relations.find((relation) => relation.kind === "contract-breaking-change");
        expect(breakingRelation).toMatchObject({
            target: "openapi:contract-removed",
            contractChange: {rule: "contract-removed"},
        });
        expect(JSON.stringify(breakingRelation)).not.toContain("/private/users");
    });
});
