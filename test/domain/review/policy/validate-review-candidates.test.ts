import { describe, expect, it } from "vitest";
import { validateReviewCandidates } from "../../../../src/domain/review/policy/validate-review-candidates.js";

const codeChange = {
    diff: "@@ -0,0 +10,2 @@\n+const enabled = true;\n+run(enabled);",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: { startLine: 10, endLine: 11 },
        content: "@@ -0,0 +10,2 @@\n+const enabled = true;\n+run(enabled);",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("validateReviewCandidates", () => {
    it("keeps only candidates anchored to the current diff with matching evidence", () => {
        const result = validateReviewCandidates([{
            severity: "high",
            title: "Missing guard",
            description: "The new call has no guard.",
            file: "src/example.ts",
            line: 11,
            chunkId: "chunk-1",
            evidence: "+run(enabled);",
        }, {
            severity: "high",
            title: "Invented code",
            description: "This should be suppressed.",
            file: "src/example.ts",
            line: 12,
            chunkId: "chunk-1",
            evidence: "+missing();",
        }], codeChange);

        expect(result.findings).toEqual([expect.objectContaining({
            chunkId: "chunk-1",
            evidence: "+run(enabled);",
            verificationStatus: "grounded",
            verificationMethods: ["diff-anchor", "evidence-match"],
        })]);
        expect(result.suppressedCounts).toEqual({ "location-mismatch": 1 });
    });

    it("suppresses candidates without a known chunk or literal evidence", () => {
        const result = validateReviewCandidates([{
            severity: "medium",
            title: "Unknown location",
            description: "Missing chunk.",
        }, {
            severity: "medium",
            title: "Mismatched evidence",
            description: "No matching text.",
            chunkId: "chunk-1",
            evidence: "+missing();",
        }], codeChange);

        expect(result.findings).toEqual([]);
        expect(result.suppressedCounts).toEqual({
            "missing-chunk-reference": 1,
            "evidence-mismatch": 1,
        });
    });
});
