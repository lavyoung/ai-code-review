import {describe, expect, it} from "vitest";
import {createImpactPackage} from "../../../../src/application/review/changes/create-impact-package.js";

const revision = "a".repeat(40);

describe("createImpactPackage", () => {
    it("classifies observed persistence edges even when symbol metadata is the first relation", () => {
        const result = createImpactPackage([{
            id: "symbol-relation",
            changeAnchorId: "chunk-persistence",
            sourcePath: "src/repository.ts",
            sourceLine: 4,
            target: "src.repository.saveUser",
            kind: "symbol-change",
            completeness: "partial",
        }, {
            id: "persistence-relation",
            changeAnchorId: "chunk-persistence",
            sourcePath: "src/repository.ts",
            sourceLine: 5,
            target: "repository.save",
            kind: "persists",
            completeness: "partial",
        }]);

        expect(result.impacts).toMatchObject([{kind: "persistence"}]);
        expect(result.testObligations).toMatchObject([{kind: "persistence"}]);
    });

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
            businessContext: {status: "unavailable", associations: []},
            consumerContext: {status: "unavailable", associations: []},
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
        }], [], {status: "available", sourceRevision: revision, frameworks: ["vitest"], assetCount: 2, staticReferences: []}))
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
        }], [], {status: "partial", sourceRevision: revision, frameworks: ["vitest"], assetCount: 64, staticReferences: []}))
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
            sourceRevision: revision,
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src/example",
                kind: "module-import",
                framework: "vitest",
                sourceRevision: revision,
                association: "direct-static-import",
            }],
        }, {sourceRevision: revision, passedTestIds: ["test-asset:1"]})).toMatchObject({
            impactCoverage: [{
                status: "partial",
                evidence: [{kind: "impact-association", referenceId: "test-reference:1"}],
                limitation: "impact-association-insufficient",
            }],
        });
    });

    it("associates a test with a changed source file even when the source changed no import", () => {
        expect(createImpactPackage([{
            id: "source-change-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "changed-typescript-source",
            kind: "typescript-source-change",
            completeness: "partial",
        }], [], {
            status: "available",
            sourceRevision: revision,
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src/example",
                kind: "module-import",
                framework: "vitest",
                sourceRevision: revision,
                association: "direct-static-import",
            }],
        })).toMatchObject({
            impactCoverage: [{
                status: "partial",
                evidence: [{kind: "impact-association", referenceId: "test-reference:1"}],
            }],
        });
    });

    it("demonstrates an impact only when an associated test has signed execution evidence", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "changed-typescript-source",
            kind: "typescript-source-change",
            completeness: "partial",
            sourceSymbol: {
                language: "typescript",
                qualifiedName: "src.example.example",
                signature: "()",
                sourceDigest: "source",
                stableId: "symbol:example",
            },
        }], [], {
            status: "available",
            sourceRevision: revision,
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src.example.example",
                kind: "typescript-symbol-call",
                framework: "vitest",
                sourceRevision: revision,
                association: "direct-symbol-call",
            }],
        }, {sourceRevision: revision, passedTestIds: ["test-asset:1"]})).toMatchObject({
            impactCoverage: [{
                status: "demonstrated",
                evidence: [
                    {kind: "impact-association", referenceId: "test-reference:1"},
                    {kind: "test-execution", referenceId: "test-execution:test-asset:1"},
                ],
            }],
        });
    });

    it("does not turn a changed contract into a compatibility conclusion", () => {
        expect(createImpactPackage([{
            id: "contract-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi",
            kind: "contract-definition",
            completeness: "partial",
        }])).toMatchObject({
            impacts: [{kind: "contract"}],
            testObligations: [
                {kind: "contract"},
                {kind: "compatibility"},
            ],
            impactCoverage: [
                {status: "not-assessable", limitation: "contract-validation-unavailable"},
                {status: "not-assessable", limitation: "consumer-compatibility-unavailable"},
            ],
        });
    });

    it("does not demonstrate coverage when execution and inventory revisions differ", () => {
        const result = createImpactPackage([{
            id: "source-change-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "changed-typescript-source",
            kind: "typescript-source-change",
            completeness: "partial",
            sourceSymbol: {
                language: "typescript",
                qualifiedName: "src.example.example",
                sourceDigest: "source",
                stableId: "symbol:example",
            },
        }], [], {
            status: "available",
            sourceRevision: revision,
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:1",
                testId: "test-asset:1",
                target: "src.example.example",
                kind: "typescript-symbol-call",
                framework: "vitest",
                sourceRevision: revision,
                association: "direct-symbol-call",
            }],
        }, {sourceRevision: "b".repeat(40), passedTestIds: ["test-asset:1"]});

        expect(result.impactCoverage).toMatchObject([{
            status: "partial",
            limitation: "test-execution-unavailable",
        }]);
    });

    it("requires every changed symbol on an impact anchor to have passing direct-call evidence", () => {
        const symbol = (name: string) => ({
            language: "typescript" as const,
            qualifiedName: `src.example.${name}`,
            sourceDigest: name,
            stableId: `symbol:${name}`,
        });
        const result = createImpactPackage([{
            id: "source-change-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 4,
            target: "changed-typescript-source",
            kind: "typescript-source-change",
            completeness: "partial",
            sourceSymbol: symbol("first"),
        }, {
            id: "symbol-change-2",
            changeAnchorId: "chunk-1",
            sourcePath: "src/example.ts",
            sourceLine: 8,
            target: "src.example.second",
            kind: "symbol-change",
            completeness: "partial",
            targetSymbol: symbol("second"),
        }], [], {
            status: "available",
            sourceRevision: revision,
            frameworks: ["vitest"],
            assetCount: 1,
            staticReferences: [{
                id: "test-reference:first",
                testId: "test-asset:1",
                target: "src.example.first",
                kind: "typescript-symbol-call",
                framework: "vitest",
                sourceRevision: revision,
                association: "direct-symbol-call",
            }],
        }, {sourceRevision: revision, passedTestIds: ["test-asset:1"]});

        expect(result.impactCoverage).toMatchObject([{
            status: "partial",
            limitation: "impact-association-insufficient",
        }]);
    });

    it("keeps consumer compatibility closure unknown for a ruleset-confirmed structural break", () => {
        const result = createImpactPackage([{
            id: "contract-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi",
            kind: "contract-definition",
            completeness: "partial",
        }, {
            id: "breaking-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi:openapi-path-removed",
            kind: "contract-breaking-change",
            completeness: "complete",
            contractChange: {
                rulesetVersion: "v1",
                classification: "breaking",
                strategy: "openapi-client-backward",
                rule: "openapi-path-removed",
            },
        }]);

        expect(result.impacts[0]).toMatchObject({
            kind: "contract",
            closure: {compatibility: "unknown"},
            relations: [
                {kind: "contract-definition"},
                {kind: "contract-breaking-change", completeness: "complete"},
            ],
        });
    });

    it("demonstrates contract validation without claiming consumer compatibility", () => {
        expect(createImpactPackage([{
            id: "contract-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi",
            kind: "contract-definition",
            completeness: "partial",
        }], [], undefined, undefined, undefined, undefined, ["contract-1"])).toMatchObject({
            impactCoverage: [
                {
                    status: "demonstrated",
                    evidence: [{kind: "contract-validation", referenceId: "contract-validation:contract-1"}],
                },
                {status: "not-assessable", limitation: "consumer-compatibility-unavailable"},
            ],
        });
    });

    it("demonstrates compatibility only for every current known consumer snapshot", () => {
        expect(createImpactPackage([{
            id: "contract-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi",
            kind: "contract-definition",
            completeness: "partial",
        }], [], undefined, undefined, undefined, {
            status: "available",
            associations: [{
                changeAnchorId: "chunk-1",
                consumer: {id: "payment-sdk", owner: "payments", sourceRevision: "a".repeat(40)},
            }],
        }, ["contract-1"], [{
            changeAnchorId: "chunk-1",
            consumerId: "payment-sdk",
            consumerSourceRevision: "a".repeat(40),
        }])).toMatchObject({
            impactCoverage: [
                {status: "demonstrated", evidence: [{kind: "contract-validation"}]},
                {
                    status: "demonstrated",
                    evidence: [{
                        kind: "consumer-compatibility",
                        referenceId: "consumer-compatibility:impact:chunk-1:payment-sdk",
                    }],
                },
            ],
        });
    });

    it("includes only explicit capability mappings for the affected change anchor", () => {
        expect(createImpactPackage([{
            id: "relation-1",
            changeAnchorId: "chunk-1",
            sourcePath: "src/payment/example.ts",
            sourceLine: 4,
            target: "./service.js",
            kind: "module-import",
            completeness: "partial",
        }], [], undefined, undefined, {
            status: "available",
            associations: [{
                changeAnchorId: "chunk-1",
                capability: {id: "order-payment", owner: "payment-platform"},
            }, {
                changeAnchorId: "other-chunk",
                capability: {id: "order-fulfillment", owner: "fulfillment-platform"},
            }],
        })).toMatchObject({
            impacts: [{businessCapabilities: [{id: "order-payment", owner: "payment-platform"}]}],
        });
    });

    it("includes only known consumers explicitly mapped to a changed contract", () => {
        expect(createImpactPackage([{
            id: "contract-1",
            changeAnchorId: "chunk-1",
            sourcePath: "contracts/openapi.yaml",
            sourceLine: 2,
            target: "openapi",
            kind: "contract-definition",
            completeness: "partial",
        }], [], undefined, undefined, undefined, {
            status: "available",
            associations: [{
                changeAnchorId: "chunk-1",
                consumer: {id: "payment-sdk", owner: "payments", sourceRevision: "a".repeat(40)},
            }],
        })).toMatchObject({
            impacts: [{knownConsumers: [{id: "payment-sdk", owner: "payments"}]}],
        });
    });
});
