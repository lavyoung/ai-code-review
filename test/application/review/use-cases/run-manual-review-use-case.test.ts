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
            excludedFileCount: 0,
            redactedValueCount: 0,
        };
        const getCodeChange = vi.fn().mockResolvedValue(codeChange);
        const review = vi.fn().mockResolvedValue({
            summary: "One critical issue found.",
            findings: [{
                severity: "critical",
                title: "Critical issue",
                description: "Description.",
            }],
        });

        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getCodeChange },
            aiReviewPort: { provider: "deepseek", review },
        })).resolves.toMatchObject({
            analysis: {
                summary: "One critical issue found.",
            },
            policy: {
                highestSeverity: "critical",
                shouldFail: true,
            },
        });

        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });
        expect(review).toHaveBeenCalledWith(codeChange);
    });

    it("maps a diff provider failure to a diff resolution error", async () => {
        await expect(runManualReviewUseCase({
            target: "main",
            failOn: ["critical"],
        }, {
            diffProvider: { getCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            aiReviewPort: { provider: "deepseek", review: vi.fn() },
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
                    excludedFileCount: 0,
                    redactedValueCount: 0,
                }),
            },
            aiReviewPort: {
                provider: "deepseek",
                review: vi.fn().mockRejectedValue(new Error("AI failure")),
            },
        })).rejects.toMatchObject({
            name: AiReviewExecutionError.name,
            failureType: "unknown",
        });
    });
});
