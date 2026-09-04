import {describe, expect, it} from "vitest";
import {CommittedExternalConsumerCatalog} from "../../../src/infrastructure/impact/committed-external-consumer-catalog.js";

const relation = {
    id: "contract-1",
    changeAnchorId: "chunk-1",
    sourcePath: "contracts/openapi.yaml",
    sourceLine: 2,
    target: "openapi",
    kind: "contract-definition" as const,
    completeness: "partial" as const,
};

describe("CommittedExternalConsumerCatalog", () => {
    it("maps only approved current consumers with an immutable snapshot to an existing contract", async () => {
        const content = "version: v1\nconsumers:\n  - id: payment-sdk\n    owner: payments\n    sourceRevision: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    reviewedAt: 2026-09-01\n    expiresAt: 2027-09-01\n    authority: approved\n    status: active\n    contractPaths: [contracts/openapi.yaml]\n";
        const catalog = new CommittedExternalConsumerCatalog({
            readHeadFile: async (path) => path === "docs/context/consumers.yml" ? content : "openapi: 3.1.0\n",
        }, () => "2026-09-04");

        await expect(catalog.resolve([relation], AbortSignal.timeout(1_000))).resolves.toEqual({
            status: "available",
            associations: [{
                changeAnchorId: "chunk-1",
                consumer: {id: "payment-sdk", owner: "payments", sourceRevision: "a".repeat(40)},
            }],
        });
    });

    it("treats an expired or unavailable catalog as unknown rather than no consumers", async () => {
        const catalog = new CommittedExternalConsumerCatalog({
            readHeadFile: async () => "version: v1\nconsumers:\n  - id: payment-sdk\n    owner: payments\n    sourceRevision: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    reviewedAt: 2026-09-01\n    expiresAt: 2026-09-03\n    authority: approved\n    status: active\n    contractPaths: [contracts/openapi.yaml]\n",
        }, () => "2026-09-04");

        await expect(catalog.resolve([relation], AbortSignal.timeout(1_000))).resolves.toEqual({
            status: "unavailable",
            associations: [],
        });
    });
});
