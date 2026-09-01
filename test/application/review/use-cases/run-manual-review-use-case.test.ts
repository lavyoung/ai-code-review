import { describe, expect, it, vi } from "vitest";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import { runManualReviewUseCase } from "../../../../src/application/review/use-cases/run-manual-review-use-case.js";

const createAnalyzerDependencies = (analyze: ReturnType<typeof vi.fn>) => ({
    reviewAnalyzerRegistry: {
        resolve: (analyzerId: string) => analyzerId === "deepseek"
            ? {
                identity: { kind: "ai" as const, id: "deepseek" },
                capabilities: {
                    inputAccess: "sanitized-model-input" as const,
                    supportsChangedOnly: true,
                    supportsRepositoryScan: false,
                },
                analyze,
            }
            : undefined,
    },
    analyzerPlans: [{
        analyzerId: "deepseek",
        required: true,
        timeoutMs: 1_000,
        failureMode: "fail" as const,
    }],
    analyzerBudget: { totalTimeoutMs: 1_000, maxConcurrency: 1, maxAiRequestCount: 1 },
});

describe("runManualReviewUseCase", () => {
    it("orchestrates diff loading, AI review, and the quality gate", async () => {
        const rawCodeChange = {
            fileChanges: [{
                file: { path: "src/example.ts", status: "modified" as const },
                diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+throw new Error('failure');\n",
            }],
        };
        const getRawCodeChange = vi.fn().mockResolvedValue(rawCodeChange);
        const analyze = vi.fn().mockImplementation(({ codeChange }) => ({
            summary: "One critical issue found.",
            findings: [{
                severity: "critical",
                title: "Critical issue",
                description: "Description.",
                file: "src/example.ts",
                line: 1,
                chunkId: codeChange.chunks[0]?.id,
                evidence: "+throw new Error('failure');",
            }],
        }));

        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getRawCodeChange },
            ...createAnalyzerDependencies(analyze),
        })).resolves.toMatchObject({
            analysis: {
                summary: "One critical issue found.",
            },
            policy: {
                highestSeverity: "critical",
                shouldFail: false,
            },
        });

        expect(getRawCodeChange).toHaveBeenCalledWith({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });
        expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
            codeChange: expect.objectContaining({ files: [{ path: "src/example.ts", status: "modified" }] }),
        }));
    });

    it("maps a diff provider failure to a diff resolution error", async () => {
        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getRawCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            ...createAnalyzerDependencies(vi.fn()),
        })).rejects.toBeInstanceOf(DiffResolutionError);
    });

    it("maps an AI provider failure to an AI review execution error", async () => {
        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: {
                getRawCodeChange: vi.fn().mockResolvedValue({ fileChanges: [] }),
            },
            ...createAnalyzerDependencies(vi.fn().mockRejectedValue(new Error("AI failure"))),
        })).rejects.toMatchObject({
            name: AiReviewExecutionError.name,
            failureType: "unknown",
        });
    });
});
