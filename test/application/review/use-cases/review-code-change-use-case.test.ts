import { describe, expect, it, vi } from "vitest";
import { StaticReviewAnalyzerRegistry } from "../../../../src/application/review/orchestration/static-review-analyzer-registry.js";
import { reviewCodeChangeUseCase } from "../../../../src/application/review/use-cases/review-code-change-use-case.js";
import { deterministicAnalyzerFindingVerifier } from "../../../../src/application/review/verification/deterministic-analyzer-finding-verifier.js";

const codeChange = {
    diff: "@@ -0,0 +1 @@\n+const value: number = 'invalid';",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: { startLine: 1, endLine: 1 },
        content: "@@ -0,0 +1 @@\n+const value: number = 'invalid';",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("reviewCodeChangeUseCase", () => {
    it("lets an anchored deterministic result participate in the quality gate", async () => {
        const analyzer = {
            identity: { kind: "typecheck" as const, id: "typescript" },
            capabilities: {
                inputAccess: "trusted-raw-local" as const,
                supportsChangedOnly: true,
                supportsRepositoryScan: false,
            },
            analyze: vi.fn().mockResolvedValue({
                summary: "Type error found.",
                findings: [{
                    severity: "critical",
                    title: "Incompatible assignment",
                    description: "A string is assigned to a number.",
                    file: "src/example.ts",
                    line: 1,
                    chunkId: "chunk-1",
                    evidence: "+const value: number = 'invalid';",
                    // The executor must replace even a malicious claimed source.
                    analyzer: { kind: "ai", id: "untrusted-output" },
                }],
            }),
        };

        const result = await reviewCodeChangeUseCase({
            codeChange,
            failOn: ["critical"],
        }, {
            reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry([analyzer]),
            analyzerPlans: [{
                analyzerId: "typescript",
                required: true,
                timeoutMs: 1_000,
                failureMode: "fail",
            }],
            analyzerBudget: { totalTimeoutMs: 1_000, maxConcurrency: 1, maxAiRequestCount: 0 },
            findingVerifiers: [deterministicAnalyzerFindingVerifier],
        });

        expect(result.findings).toEqual([expect.objectContaining({
            verificationStatus: "verified",
            analyzer: { kind: "typecheck", id: "typescript" },
            verificationMethods: ["diff-anchor", "evidence-match", "deterministic-analyzer"],
        })]);
        expect(result.policy).toEqual({ highestSeverity: "critical", shouldFail: true });
    });
});
