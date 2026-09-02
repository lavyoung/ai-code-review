import {describe, expect, it} from "vitest";
import {validateReviewCandidates} from "../../../../src/domain/review/policy/validate-review-candidates.js";

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
            disposition: "advisory",
            verificationMethods: ["diff-anchor", "source-range", "evidence-match"],
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

    it("does not claim source-range verification for a finding without a line", () => {
        const result = validateReviewCandidates([{
            severity: "low",
            title: "General observation",
            description: "The hunk needs a follow-up review.",
            chunkId: "chunk-1",
            evidence: "+const enabled = true;",
        }], codeChange);

        expect(result.findings).toEqual([expect.objectContaining({
            verificationMethods: ["diff-anchor", "evidence-match"],
        })]);
    });

    it("suppresses an AI conclusion that depends on a redaction placeholder", () => {
        const result = validateReviewCandidates([{
            severity: "high",
            title: "Invalid API key check",
            description: "The [REDACTED] value causes a syntax error.",
            chunkId: "chunk-1",
            evidence: "+const enabled = true;",
            analyzer: {kind: "ai", id: "deepseek"},
        }], codeChange);

        expect(result.findings).toEqual([]);
        expect(result.suppressedCounts).toEqual({"redacted-dependency": 1});
    });

    it("keeps redacted evidence from a deterministic secret scanner", () => {
        const result = validateReviewCandidates([{
            severity: "critical",
            title: "Credential detected",
            description: "A high-confidence credential pattern was added.",
            chunkId: "chunk-1",
            evidence: "+const enabled = [REDACTED];",
            analyzer: {kind: "secret-scan", id: "secret-scanner"},
        }], {
            ...codeChange,
            chunks: [{
                ...codeChange.chunks[0],
                content: "@@ -0,0 +10,1 @@\n+const enabled = [REDACTED];",
            }],
        });

        expect(result.findings).toEqual([expect.objectContaining({
            evidence: "+const enabled = [REDACTED];",
            disposition: "advisory",
        })]);
    });
});
