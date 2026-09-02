import {describe, expect, it} from "vitest";
import {verifyReviewFindings} from "../../../../src/application/review/orchestration/verify-review-findings.js";
import {ReviewVerifierExecutionError} from "../../../../src/application/review/errors/review-execution-error.js";

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
    disposition: "advisory" as const,
    verificationMethods: ["diff-anchor", "evidence-match"],
    analyzer: { kind: "ai" as const, id: "deepseek" },
};

describe("verifyReviewFindings", () => {
    it("only accepts verification-state changes from a verifier", () => {
        const result = verifyReviewFindings([finding], codeChange, [{
            id: "test-verifier",
            verify: () => ({
                ...finding,
                severity: "critical",
                title: "Rewritten finding",
                verificationStatus: "verified",
                disposition: "defect",
                verificationMethods: ["deterministic-analyzer"],
            }),
        }]);

        expect(result).toEqual([{
            ...finding,
            verificationStatus: "verified",
            disposition: "defect",
            verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
        }]);
    });

    it("wraps verifier failures without exposing the underlying error", () => {
        try {
            verifyReviewFindings([finding], codeChange, [{
                id: "failing-verifier",
                verify: () => {
                    throw new Error("token=not-for-output");
                },
            }]);
        } catch (error) {
            expect(error).toMatchObject({
                name: ReviewVerifierExecutionError.name,
                verifierId: "failing-verifier",
            });
            expect(String(error)).not.toContain("not-for-output");
            return;
        }

        throw new Error("Expected the failing verifier to throw.");
    });
});
