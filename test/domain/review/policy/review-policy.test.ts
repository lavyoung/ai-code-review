import { describe, expect, it } from "vitest";
import { evaluateReviewPolicy } from "../../../../src/domain/review/policy/review-policy.js";

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
            },
            {
                severity: "critical",
                title: "Critical issue",
                description: "Description.",
            },
        ], ["critical"])).toEqual({
            highestSeverity: "critical",
            shouldFail: true,
        });
    });
});
