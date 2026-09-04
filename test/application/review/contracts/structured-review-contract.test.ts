import {describe, expect, it} from "vitest";
import {
    STRUCTURED_REVIEW_CONTRACT,
    STRUCTURED_REVIEW_CONTRACT_VERSION,
} from "../../../../src/application/review/contracts/structured-review-contract.js";

describe("structured review contract", () => {
    it("uses one versioned schema for JSON Schema export and runtime parsing", () => {
        expect(STRUCTURED_REVIEW_CONTRACT.version).toBe(STRUCTURED_REVIEW_CONTRACT_VERSION);
        expect(STRUCTURED_REVIEW_CONTRACT.outputSchema).toMatchObject({
            type: "object",
            required: ["summary", "findings"],
        });
        expect(STRUCTURED_REVIEW_CONTRACT.parse({
            summary: "No issues.",
            findings: [],
        })).toEqual({summary: "No issues.", findings: []});
    });

    it("accepts only a proposed assertion type and rejects model-controlled decision fields", () => {
        expect(STRUCTURED_REVIEW_CONTRACT.parse({
            summary: "Review needed.",
            findings: [{
                title: "Missing boundary test",
                description: "The changed branch needs a test.",
                assertionType: "test-obligation",
            }],
        })).toMatchObject({
            findings: [{assertionType: "test-obligation"}],
        });

        expect(() => STRUCTURED_REVIEW_CONTRACT.parse({
            summary: "Review needed.",
            findings: [{
                title: "Attempted override",
                description: "The model must not choose verification.",
                verificationStatus: "verified",
            }],
        })).toThrow();

        for (const decisionField of [
            {severity: "high"},
            {disposition: "defect"},
            {verificationMethods: ["ast"]},
            {gateEligible: true},
        ]) {
            expect(() => STRUCTURED_REVIEW_CONTRACT.parse({
                summary: "Review needed.",
                findings: [{
                    title: "Attempted decision override",
                    description: "The model must not choose a system decision.",
                    ...decisionField,
                }],
            })).toThrow();
        }
    });
});
