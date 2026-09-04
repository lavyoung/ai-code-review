import {describe, expect, it} from "vitest";
import {CommittedBusinessContextCatalog} from "../../../src/infrastructure/impact/committed-business-context-catalog.js";

const codeChange = {
    diff: "",
    files: [{path: "src/payment/service.ts", status: "modified" as const}],
    chunks: [{
        id: "chunk-1",
        path: "src/payment/service.ts",
        newRange: {startLine: 1, endLine: 1},
        content: "+export const pay = () => {};",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("CommittedBusinessContextCatalog", () => {
    it("maps changed chunks only through an approved, current explicit path prefix", async () => {
        const catalog = new CommittedBusinessContextCatalog({
            readHeadFile: async () => "version: v1\ncapabilities:\n  - id: order-payment\n    owner: payment-platform\n    reviewedAt: 2026-09-01\n    expiresAt: 2027-09-01\n    authority: approved\n    pathPrefixes: [src/payment/]\n",
        }, () => "2026-09-04");

        await expect(catalog.resolve(codeChange, AbortSignal.timeout(1_000))).resolves.toEqual({
            status: "available",
            associations: [{
                changeAnchorId: "chunk-1",
                capability: {id: "order-payment", owner: "payment-platform"},
            }],
        });
    });

    it("rejects an expired or wildcard catalog instead of inferring business context", async () => {
        const catalog = new CommittedBusinessContextCatalog({
            readHeadFile: async () => "version: v1\ncapabilities:\n  - id: order-payment\n    owner: payment-platform\n    reviewedAt: 2026-09-01\n    expiresAt: 2026-09-03\n    authority: approved\n    pathPrefixes: [src/*]\n",
        }, () => "2026-09-04");

        await expect(catalog.resolve(codeChange, AbortSignal.timeout(1_000))).resolves.toEqual({
            status: "unavailable",
            associations: [],
        });
    });
});
