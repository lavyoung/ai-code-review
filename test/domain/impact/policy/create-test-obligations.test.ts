import {describe, expect, it} from "vitest";
import {createTestObligations} from "../../../../src/domain/impact/policy/create-test-obligations.js";

describe("createTestObligations", () => {
    it("creates an evidence-seeking obligation only for an anchored relation", () => {
        expect(createTestObligations([{
            id: "impact:chunk-1",
            changeAnchorId: "chunk-1",
            kind: "local-behavior",
            relations: [{
                id: "relation-1",
                changeAnchorId: "chunk-1",
                sourcePath: "src/example.ts",
                sourceLine: 2,
                target: "./service.js",
                kind: "module-import",
                completeness: "partial",
            }],
            closure: {
                implementation: "unknown",
                compatibility: "unknown",
                validation: "not-assessable",
            },
        }])).toEqual([expect.objectContaining({
            id: "test-obligation:impact:chunk-1:happy-path",
            requiredEvidence: ["test-execution", "impact-association"],
        })]);
    });

    it("does not turn an impact without a path into a missing-test claim", () => {
        expect(createTestObligations([{
            id: "impact:chunk-1",
            changeAnchorId: "chunk-1",
            kind: "local-behavior",
            relations: [],
            closure: {
                implementation: "unknown",
                compatibility: "unknown",
                validation: "not-assessable",
            },
        }])).toEqual([]);
    });
});
