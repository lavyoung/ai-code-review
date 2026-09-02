import {describe, expect, it} from "vitest";
import {
    deduplicateReviewFindings
} from "../../../../src/application/review/orchestration/deduplicate-review-findings.js";

const baseFinding = {
    fingerprint: "initial-fingerprint",
    severity: "high" as const,
    title: "Unsafe assignment",
    description: "Description that may differ between analyzers.",
    file: "src/example.ts",
    line: 4,
    category: "typecheck",
    chunkId: "chunk-1",
    evidence: "+const value: number = 'invalid';",
    verificationStatus: "grounded" as const,
    disposition: "advisory" as const,
    verificationMethods: ["diff-anchor", "evidence-match"],
    analyzer: { kind: "ai" as const, id: "deepseek" },
    analyzers: [{ kind: "ai" as const, id: "deepseek" }],
};

describe("deduplicateReviewFindings", () => {
    it("uses a stable safe fingerprint and preserves deterministic verification and sources", () => {
        const result = deduplicateReviewFindings([
            baseFinding,
            {
                ...baseFinding,
                description: "The TypeScript compiler confirmed the assignment.",
                verificationStatus: "verified" as const,
                disposition: "defect" as const,
                verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
                analyzer: { kind: "typecheck" as const, id: "typescript" },
                analyzers: [{ kind: "typecheck" as const, id: "typescript" }],
            },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            verificationStatus: "verified",
            disposition: "defect",
            analyzers: [
                { kind: "ai", id: "deepseek" },
                { kind: "typecheck", id: "typescript" },
            ],
            verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
        });
        expect(result[0]?.fingerprint).toMatch(/^[a-f0-9]{24}$/);
        expect(result[0]?.fingerprint).not.toContain("invalid");
    });

    it("keeps findings at different changed locations separate", () => {
        expect(deduplicateReviewFindings([
            baseFinding,
            { ...baseFinding, line: 5, chunkId: "chunk-2" },
        ])).toHaveLength(2);
    });
});
