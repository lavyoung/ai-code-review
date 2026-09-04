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
            limitations: ["dynamic-dependency-unavailable"],
        });
    });
});
