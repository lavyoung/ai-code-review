import { describe, expect, it, vi } from "vitest";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import { runManualReviewUseCase } from "../../../../src/application/review/use-cases/run-manual-review-use-case.js";

describe("runManualReviewUseCase", () => {
    it("orchestrates diff loading, AI review, and the quality gate", async () => {
        const codeChange = {
            diff: "diff --git a/src/example.ts b/src/example.ts\n",
            files: [{ path: "src/example.ts", status: "modified" as const }],
            chunks: [{
                id: "chunk-1",
                path: "src/example.ts",
                newRange: { startLine: 1, endLine: 1 },
                content: "+throw new Error('failure');",
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        };
        const getCodeChange = vi.fn().mockResolvedValue(codeChange);
        const analyze = vi.fn().mockResolvedValue({
            summary: "One critical issue found.",
            findings: [{
                severity: "critical",
                title: "Critical issue",
                description: "Description.",
                file: "src/example.ts",
                line: 1,
                chunkId: "chunk-1",
                evidence: "+throw new Error('failure');",
            }],
        });

        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getCodeChange },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze },
        })).resolves.toMatchObject({
            analysis: {
                summary: "One critical issue found.",
            },
            policy: {
                highestSeverity: "critical",
                shouldFail: false,
            },
        });

        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });
        expect(analyze).toHaveBeenCalledWith({ codeChange });
    });

    it("maps a diff provider failure to a diff resolution error", async () => {
        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze: vi.fn() },
        })).rejects.toBeInstanceOf(DiffResolutionError);
    });

    it("maps an AI provider failure to an AI review execution error", async () => {
        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: {
                getCodeChange: vi.fn().mockResolvedValue({
                    diff: "",
                    files: [],
                    chunks: [],
                    excludedFileCount: 0,
                    redactedValueCount: 0,
                }),
            },
            reviewAnalyzer: {
                identity: { kind: "ai", id: "deepseek" },
                capabilities: { inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false },
                analyze: vi.fn().mockRejectedValue(new Error("AI failure")),
            },
        })).rejects.toMatchObject({
            name: AiReviewExecutionError.name,
            failureType: "unknown",
        });
    });
});
