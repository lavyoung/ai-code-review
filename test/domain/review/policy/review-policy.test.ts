import {describe, expect, it} from "vitest";
import {evaluateReviewPolicy} from "../../../../src/domain/review/policy/review-policy.js";

describe("evaluateReviewPolicy", () => {
    it("returns no highest severity and does not fail when there are no findings", () => {
        expect(evaluateReviewPolicy([], ["critical"])).toEqual({
            highestSeverity: null,
            shouldFail: false,
        });
    });

    it("uses the highest finding severity and configured quality gate", () => {
        expect(evaluateReviewPolicy([
            {
                severity: "medium",
                title: "Medium issue",
                description: "Description.",
                chunkId: "chunk-1",
                evidence: "+const medium = true;",
                verificationStatus: "grounded",
                disposition: "advisory",
            },
            {
                severity: "critical",
                title: "Critical issue",
                description: "Description.",
                chunkId: "chunk-2",
                evidence: "+throw new Error();",
                verificationStatus: "verified",
                disposition: "defect",
            },
        ], ["critical"])).toEqual({
            highestSeverity: "critical",
            shouldFail: true,
        });
    });

    it("does not allow an AI assertion to expand the quality gate", () => {
        expect(evaluateReviewPolicy([{
            severity: "critical",
            title: "Untrusted AI assertion",
            description: "A verifier must not promote this AI-only claim to a gate.",
            chunkId: "chunk-1",
            evidence: "+const changed = true;",
            verificationStatus: "verified",
            disposition: "defect",
            assertion: {
                type: "regression-risk",
                author: "ai",
                factIds: ["diff-anchor:chunk-1"],
                uncertainty: "none",
            },
        }], ["critical"])).toEqual({
            highestSeverity: "critical",
            shouldFail: false,
        });
    });
});
