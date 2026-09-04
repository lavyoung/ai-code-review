import {describe, expect, it, vi} from "vitest";
import {
    StaticReviewAnalyzerRegistry
} from "../../../../src/application/review/orchestration/static-review-analyzer-registry.js";
import {reviewCodeChangeUseCase} from "../../../../src/application/review/use-cases/review-code-change-use-case.js";
import {
    deterministicAnalyzerFindingVerifier
} from "../../../../src/application/review/verification/deterministic-analyzer-finding-verifier.js";

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
            identity: {kind: "typecheck" as const, id: "typescript", verificationEligible: true},
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
            reviewInput: { rawCodeChange: { fileChanges: [] }, codeChange },
            failOn: ["critical"],
        }, {
            reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry([analyzer]),
            analyzerPlans: [{
                analyzerId: "typescript",
                required: true,
                timeoutMs: 1_000,
                failureMode: "fail",
            }],
            analyzerBudget: {
                totalTimeoutMs: 1_000,
                maxConcurrency: 1,
                maxAiRequestCount: 0,
                maxModelInputChars: 10_000,
            },
            findingVerifiers: [deterministicAnalyzerFindingVerifier],
        });

        expect(result.findings).toEqual([expect.objectContaining({
            verificationStatus: "verified",
            disposition: "defect",
            analyzer: {kind: "typecheck", id: "typescript", verificationEligible: true},
            verificationMethods: ["diff-anchor", "source-range", "evidence-match", "deterministic-analyzer"],
        })]);
        expect(result.policy).toEqual({ highestSeverity: "critical", shouldFail: true });
    });

    it("suppresses only AI advisory findings recorded as false positives", async () => {
        const analyzer = {
            identity: {kind: "ai" as const, id: "deepseek"},
            capabilities: {
                inputAccess: "sanitized-model-input" as const,
                supportsChangedOnly: true,
                supportsRepositoryScan: false,
            },
            analyze: vi.fn().mockResolvedValue({
                summary: "Suggestion found.",
                findings: [{
                    severity: "high",
                    title: "Consider a guard",
                    description: "The changed assignment needs a guard.",
                    file: "src/example.ts",
                    line: 1,
                    chunkId: "chunk-1",
                    evidence: "+const value: number = 'invalid';",
                }],
            }),
        };

        const initialResult = await reviewCodeChangeUseCase({
            reviewInput: {rawCodeChange: {fileChanges: []}, codeChange},
            failOn: ["critical"],
        }, {
            reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry([analyzer]),
            analyzerPlans: [{analyzerId: "deepseek", required: true, timeoutMs: 1_000, failureMode: "fail"}],
            analyzerBudget: {
                totalTimeoutMs: 1_000,
                maxConcurrency: 1,
                maxAiRequestCount: 1,
                maxModelInputChars: 10_000
            },
            findingVerifiers: [deterministicAnalyzerFindingVerifier],
        });
        const fingerprint = initialResult.findings[0]?.fingerprint;
        if (fingerprint === undefined) {
            throw new Error("Expected an AI advisory fingerprint.");
        }

        const suppressedResult = await reviewCodeChangeUseCase({
            reviewInput: {rawCodeChange: {fileChanges: []}, codeChange},
            failOn: ["critical"],
        }, {
            reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry([analyzer]),
            analyzerPlans: [{analyzerId: "deepseek", required: true, timeoutMs: 1_000, failureMode: "fail"}],
            analyzerBudget: {
                totalTimeoutMs: 1_000,
                maxConcurrency: 1,
                maxAiRequestCount: 1,
                maxModelInputChars: 10_000
            },
            findingVerifiers: [deterministicAnalyzerFindingVerifier],
            findingSuppressionPort: {getActiveSuppressedFingerprints: vi.fn().mockResolvedValue([fingerprint])},
        });

        expect(suppressedResult.findings).toEqual([]);
        expect(suppressedResult.suppressedCandidateCounts).toEqual({"feedback-suppressed": 1});
        expect(suppressedResult.policy).toEqual({highestSeverity: null, shouldFail: false});
    });

    it("passes a safe static impact package to AI analyzers and degrades cleanly when unavailable", async () => {
        const analyze = vi.fn().mockResolvedValue({summary: "No issues.", findings: []});
        const analyzer = {
            identity: {kind: "ai" as const, id: "deepseek"},
            capabilities: {
                inputAccess: "sanitized-model-input" as const,
                supportsChangedOnly: true,
                supportsRepositoryScan: false,
            },
            analyze,
        };
        const semanticImpactIndex = {
            analyze: vi.fn().mockResolvedValue({
                relations: [{
                    id: "relation-1",
                    changeAnchorId: "chunk-1",
                    sourcePath: "src/example.ts",
                    sourceLine: 1,
                    target: "./service.js",
                    kind: "module-import" as const,
                    completeness: "partial" as const,
                }],
                limitations: ["dynamic-dependency-unavailable" as const],
            }),
        };
        const testInventory = {
            discover: vi.fn().mockResolvedValue({status: "available" as const, frameworks: ["vitest" as const], assetCount: 1}),
        };

        await reviewCodeChangeUseCase({
            reviewInput: {rawCodeChange: {fileChanges: []}, codeChange},
            failOn: ["critical"],
        }, {
            reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry([analyzer]),
            analyzerPlans: [{analyzerId: "deepseek", required: true, timeoutMs: 1_000, failureMode: "fail"}],
            analyzerBudget: {totalTimeoutMs: 1_000, maxConcurrency: 1, maxAiRequestCount: 1, maxModelInputChars: 10_000},
            findingVerifiers: [],
            semanticImpactIndex,
            testInventory,
        });

        expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
            impactPackage: expect.objectContaining({
                version: "v1",
                limitations: ["dynamic-dependency-unavailable"],
                testInventory: {status: "available", frameworks: ["vitest"], assetCount: 1},
            }),
        }));
        expect(semanticImpactIndex.analyze).toHaveBeenCalledWith(
            {fileChanges: []},
            codeChange,
            expect.any(AbortSignal),
        );
        expect(testInventory.discover).toHaveBeenCalledWith(expect.any(AbortSignal));
    });
});
