import {describe, expect, it} from "vitest";
import {boundImpactPackage} from "../../../../src/application/review/changes/bound-impact-package.js";

const impactPackage = {
    version: "v1" as const,
    impacts: [{
        id: "impact:chunk-1",
        changeAnchorId: "chunk-1",
        kind: "local-behavior" as const,
        relations: [],
        businessCapabilities: [{id: "order-payment", owner: "payment-platform"}],
        knownConsumers: [],
        closure: {implementation: "unknown" as const, compatibility: "unknown" as const, validation: "not-assessable" as const},
    }, {
        id: "impact:chunk-2",
        changeAnchorId: "chunk-2",
        kind: "local-behavior" as const,
        relations: [],
        businessCapabilities: [],
        knownConsumers: [],
        closure: {implementation: "unknown" as const, compatibility: "unknown" as const, validation: "not-assessable" as const},
    }],
    testObligations: [{
        id: "obligation:1",
        impactId: "impact:chunk-1",
        kind: "happy-path" as const,
        rationale: "x".repeat(300),
        requiredEvidence: ["test-execution", "impact-association"] as const,
    }],
    impactCoverage: [{obligationId: "obligation:1", status: "not-assessable" as const, evidence: []}],
    testInventory: {status: "available" as const, frameworks: ["vitest" as const], assetCount: 1, staticReferences: []},
    businessContext: {
        status: "available" as const,
        associations: [{changeAnchorId: "chunk-1", capability: {id: "order-payment", owner: "payment-platform"}}],
    },
    consumerContext: {status: "unavailable" as const, associations: []},
    limitations: [],
};

describe("boundImpactPackage", () => {
    it("keeps only context whose anchors survive the bounded diff", () => {
        const bounded = boundImpactPackage(impactPackage, new Set(["chunk-1"]), 5_000);

        expect(bounded).toMatchObject({
            impacts: [{id: "impact:chunk-1"}],
            businessContext: {associations: [{changeAnchorId: "chunk-1"}]},
        });
        expect(bounded?.impacts).toHaveLength(1);
    });

    it("marks a package truncated rather than silently omitting impact context", () => {
        const bounded = boundImpactPackage(impactPackage, new Set(["chunk-1", "chunk-2"]), 600);

        expect(bounded?.limitations).toContain("impact-package-truncated");
        expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(600);
    });

    it("omits the package when even a safe minimum cannot fit", () => {
        expect(boundImpactPackage(impactPackage, new Set(["chunk-1"]), 10)).toBeUndefined();
    });
});
