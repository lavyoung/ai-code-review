import { describe, expect, it, vi } from "vitest";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import { runPullRequestReviewUseCase } from "../../../../src/application/review/use-cases/run-pull-request-review-use-case.js";

describe("runPullRequestReviewUseCase", () => {
    const command = { baseSha: "base-sha", headSha: "head-sha", failOn: ["critical" as const] };

    it("reviews the PR committed range and applies the quality gate", async () => {
        const getCodeChange = vi.fn().mockResolvedValue({
            diff: "",
            files: [],
            chunks: [{
                id: "chunk-1",
                path: "src/example.ts",
                newRange: { startLine: 1, endLine: 1 },
                content: "+throw new Error('failure');",
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });
        const analyze = vi.fn().mockResolvedValue({
            summary: "Critical issue found.",
            findings: [{
                severity: "critical",
                title: "Issue",
                description: "Description.",
                file: "src/example.ts",
                line: 1,
                chunkId: "chunk-1",
                evidence: "+throw new Error('failure');",
            }],
        });

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze },
        })).resolves.toMatchObject({
            policy: { shouldFail: false },
            findings: [{ verificationStatus: "grounded" }],
        });
        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "base-sha",
            headRef: "head-sha",
            comparison: "three-dot",
        });
    });

    it("keeps AI failures distinct from Git diff failures", async () => {
        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange: vi.fn().mockResolvedValue({
                diff: "", files: [], chunks: [], excludedFileCount: 0, redactedValueCount: 0,
            }) },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze: vi.fn().mockRejectedValue(new Error("AI failure")) },
        })).rejects.toBeInstanceOf(AiReviewExecutionError);

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze: vi.fn() },
        })).rejects.toBeInstanceOf(DiffResolutionError);
    });
});
