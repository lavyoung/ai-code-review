import { describe, expect, it, vi } from "vitest";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import { runPullRequestReviewUseCase } from "../../../../src/application/review/use-cases/run-pull-request-review-use-case.js";

describe("runPullRequestReviewUseCase", () => {
    const command = { baseSha: "base-sha", headSha: "head-sha", failOn: ["critical" as const] };

    it("reviews the PR committed range and applies the quality gate", async () => {
        const getRawCodeChange = vi.fn().mockResolvedValue({
            fileChanges: [{
                file: { path: "src/example.ts", status: "modified" as const },
                diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+throw new Error('failure');\n",
            }],
        });
        const analyze = vi.fn().mockImplementation(({ codeChange }) => ({
            summary: "Critical issue found.",
            findings: [{
                severity: "critical",
                title: "Issue",
                description: "Description.",
                file: "src/example.ts",
                line: 1,
                chunkId: codeChange.chunks[0]?.id,
                evidence: "+throw new Error('failure');",
            }],
        }));

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getRawCodeChange },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze },
        })).resolves.toMatchObject({
            policy: { shouldFail: false },
            findings: [{ verificationStatus: "grounded" }],
        });
        expect(getRawCodeChange).toHaveBeenCalledWith({
            baseRef: "base-sha",
            headRef: "head-sha",
            comparison: "three-dot",
        });
    });

    it("keeps AI failures distinct from Git diff failures", async () => {
        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getRawCodeChange: vi.fn().mockResolvedValue({ fileChanges: [] }) },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze: vi.fn().mockRejectedValue(new Error("AI failure")) },
        })).rejects.toBeInstanceOf(AiReviewExecutionError);

        await expect(runPullRequestReviewUseCase(command, {
            diffProvider: { getRawCodeChange: vi.fn().mockRejectedValue(new Error("Git failure")) },
            reviewAnalyzer: { identity: { kind: "ai", id: "deepseek" }, capabilities: {
                inputAccess: "sanitized-model-input", supportsChangedOnly: true, supportsRepositoryScan: false,
            }, analyze: vi.fn() },
        })).rejects.toBeInstanceOf(DiffResolutionError);
    });
});
