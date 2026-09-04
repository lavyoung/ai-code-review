import {describe, expect, it} from "vitest";
import {createImpactPackage} from "../../../../src/application/review/changes/create-impact-package.js";

describe("createImpactPackage", () => {
    it("groups only anchored static relations and preserves explicit limitations", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], ["dynamic-dependency-unavailable"])).toEqual({
            version: "v1",
            impacts: [expect.objectContaining({
                id: "impact:chunk-1",
                changeAnchorId: "chunk-1",
                closure: {
                    implementation: "unknown",
                    compatibility: "unknown",
                    validation: "not-assessable",
                },
            })],
            testObligations: [expect.objectContaining({
                impactId: "impact:chunk-1",
                kind: "happy-path",
                requiredEvidence: ["test-execution", "impact-association"],
            })],
            impactCoverage: [expect.objectContaining({
                status: "not-assessable",
                limitation: "test-inventory-unavailable",
            })],
            testInventory: {status: "unavailable", frameworks: [], assetCount: 0, staticReferences: []},
            limitations: ["dynamic-dependency-unavailable"],
        });
    });

    it("keeps coverage unproven when test assets exist without an impact association", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], [], {status: "available", frameworks: ["vitest"], assetCount: 2, staticReferences: []}))
            .toMatchObject({
                impactCoverage: [{
                    status: "not-demonstrated",
                    limitation: "impact-association-unavailable",
                }],
                testInventory: {status: "available", frameworks: ["vitest"], assetCount: 2, staticReferences: []},
            });
    });

    it("keeps coverage not-assessable when inventory discovery is incomplete", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], [], {status: "partial", frameworks: ["vitest"], assetCount: 64, staticReferences: []}))
            .toMatchObject({
                impactCoverage: [{
                    status: "not-assessable",
                    limitation: "test-inventory-partial",
                }],
            });
    });

    it("records a partial result for a test that statically imports the changed TypeScript source", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], [], {
            status: "available",
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src/example",
                kind: "module-import",
            }],
        })).toMatchObject({
            impactCoverage: [{
                status: "partial",
                evidence: [{kind: "impact-association", referenceId: "test-reference:1"}],
                limitation: "test-execution-unavailable",
            }],
        });
    });

    it("demonstrates an impact only when an associated test has signed execution evidence", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], [], {
            status: "available",
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src/example",
                kind: "module-import",
            }],
        }, ["test-asset:1"])).toMatchObject({
            impactCoverage: [{
                status: "demonstrated",
                evidence: [
                    {kind: "impact-association", referenceId: "test-reference:1"},
                    {kind: "test-execution", referenceId: "test-execution:test-asset:1"},
                ],
            }],
        });
    });
});
