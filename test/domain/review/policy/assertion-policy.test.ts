import {describe, expect, it} from "vitest";
import {
    createReviewAssertion,
    resolveAssertionPolicy,
} from "../../../../src/domain/review/policy/assertion-policy.js";

describe("assertion policy", () => {
    it("keeps verification requirements in the system-owned policy", () => {
        const facts = [{
            id: "diff-anchor:chunk-1",
            kind: "diff-anchor" as const,
            source: "candidate-validation" as const,
            verification: "confirmed" as const,
        }];

        expect(createReviewAssertion("regression-risk", "ai", facts)).toEqual({
            type: "regression-risk",
            author: "ai",
            factIds: ["diff-anchor:chunk-1"],
            uncertainty: "none",
        });
        expect(resolveAssertionPolicy("regression-risk")).toMatchObject({
            advisorySeverity: "medium",
            gateEligible: false,
            requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        });
    });
});
