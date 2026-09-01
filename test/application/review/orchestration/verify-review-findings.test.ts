import { describe, expect, it } from "vitest";
import { verifyReviewFindings } from "../../../../src/application/review/orchestration/verify-review-findings.js";

const codeChange = {
    diff: "",
    files: [],
    chunks: [],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

const finding = {
    severity: "high" as const,
    title: "Anchored finding",
    description: "Description.",
    chunkId: "chunk-1",
    evidence: "+const enabled = true;",
    verificationStatus: "grounded" as const,
    verificationMethods: ["diff-anchor", "evidence-match"],
    analyzer: { kind: "ai" as const, id: "deepseek" },
};

describe("verifyReviewFindings", () => {
    it("only accepts verification-state changes from a verifier", () => {
        const result = verifyReviewFindings([finding], codeChange, [{
            verify: () => ({
                ...finding,
                severity: "critical",
                title: "Rewritten finding",
                verificationStatus: "verified",
                verificationMethods: ["deterministic-analyzer"],
            }),
        }]);

        expect(result).toEqual([{
            ...finding,
            verificationStatus: "verified",
            verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
        }]);
    });
});
