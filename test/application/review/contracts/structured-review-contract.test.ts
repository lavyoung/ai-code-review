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
});
