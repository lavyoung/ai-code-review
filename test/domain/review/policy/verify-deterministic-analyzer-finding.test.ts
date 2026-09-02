import {describe, expect, it} from "vitest";
import {
    verifyDeterministicAnalyzerFinding
} from "../../../../src/domain/review/policy/verify-deterministic-analyzer-finding.js";

const groundedFinding = {
    severity: "critical" as const,
    title: "Unsafe type assertion",
    description: "Type checking reported an incompatible assignment.",
    chunkId: "chunk-1",
    evidence: "+const value: number = 'invalid';",
    verificationStatus: "grounded" as const,
    verificationMethods: ["diff-anchor", "evidence-match"] as const,
};

describe("verifyDeterministicAnalyzerFinding", () => {
    it("upgrades an anchored finding from a deterministic analyzer", () => {
        expect(verifyDeterministicAnalyzerFinding({
            ...groundedFinding,
            analyzer: { kind: "typecheck", id: "typescript" },
        })).toMatchObject({
            verificationStatus: "verified",
            verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
        });
    });

    it("does not treat an AI finding as independently verified", () => {
        expect(verifyDeterministicAnalyzerFinding({
            ...groundedFinding,
            analyzer: { kind: "ai", id: "deepseek" },
        })).toEqual({
            ...groundedFinding,
            analyzer: { kind: "ai", id: "deepseek" },
        });
    });

    it("records AST evidence for a trusted AST analyzer", () => {
        expect(verifyDeterministicAnalyzerFinding({
            ...groundedFinding,
            analyzer: {kind: "ast", id: "typescript-ast"},
        })).toMatchObject({
            verificationStatus: "verified",
            verificationMethods: ["diff-anchor", "evidence-match", "ast", "deterministic-analyzer"],
        });
    });
});
