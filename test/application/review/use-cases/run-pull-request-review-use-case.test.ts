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
            excludedFileCount: 0,
            redactedValueCount: 0,
        });
        const review = vi.fn().mockResolvedValue({
            summary: "Critical issue found.",
            findings: [{ severity: "critical", title: "Issue", description: "Description." }],
        });

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange },
            aiReviewPort: { provider: "deepseek", review },
        })).resolves.toMatchObject({ policy: { shouldFail: true } });
        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "base-sha",
            headRef: "head-sha",
            comparison: "three-dot",
        });
    });

    it("keeps AI failures distinct from Git diff failures", async () => {
        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange: vi.fn().mockResolvedValue({
                diff: "", files: [], excludedFileCount: 0, redactedValueCount: 0,
            }) },
            aiReviewPort: { provider: "deepseek", review: vi.fn().mockRejectedValue(new Error("AI failure")) },
        })).rejects.toBeInstanceOf(AiReviewExecutionError);

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            aiReviewPort: { provider: "deepseek", review: vi.fn() },
        })).rejects.toBeInstanceOf(DiffResolutionError);
    });
});
