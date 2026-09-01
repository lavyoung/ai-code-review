import { describe, expect, it, vi } from "vitest";
import {
    AiReviewFailure,
    AiReviewExecutionError,
    ReviewAnalyzerExecutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import { executeReviewAnalyzers } from "../../../../src/application/review/orchestration/execute-review-analyzers.js";
import { StaticReviewAnalyzerRegistry } from "../../../../src/application/review/orchestration/static-review-analyzer-registry.js";

const budget = { totalTimeoutMs: 1_000, maxConcurrency: 2, maxAiRequestCount: 2 };

const codeChange = {
    diff: "",
    files: [],
    chunks: [],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

const createAnalyzer = (analyze: ReturnType<typeof vi.fn>) => ({
    identity: { kind: "ai" as const, id: "deepseek" },
    capabilities: {
        inputAccess: "sanitized-model-input" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    },
    analyze,
});

const createNamedAnalyzer = (id: string, analyze: ReturnType<typeof vi.fn>) => ({
    ...createAnalyzer(analyze),
    identity: { kind: "ai" as const, id },
});

describe("executeReviewAnalyzers", () => {
    it("records advisory failures while preserving completed analyzer results", async () => {
        const completed = createAnalyzer(vi.fn().mockResolvedValue({
            summary: "Completed.",
            findings: [],
        }));
        const registry = new StaticReviewAnalyzerRegistry([completed]);

        const result = await executeReviewAnalyzers(codeChange, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }, {
            analyzerId: "optional-linter",
            required: false,
            timeoutMs: 1_000,
            failureMode: "degrade",
        }], registry, budget);

        expect(result.analysis).toMatchObject({ summary: "Completed." });
        expect(result.runs.map((run) => run.status).sort()).toEqual(["completed", "degraded"]);
    });

    it("preserves classified AI failures for required analyzers", async () => {
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(
            vi.fn().mockRejectedValue(new AiReviewFailure("rate-limit", "Rate limited.")),
        )]);

        await expect(executeReviewAnalyzers(codeChange, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], registry, budget)).rejects.toBeInstanceOf(AiReviewExecutionError);
    });

    it("fails a required unregistered analyzer with a generic analyzer error", async () => {
        await expect(executeReviewAnalyzers(codeChange, [{
            analyzerId: "typescript",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], new StaticReviewAnalyzerRegistry([]), budget)).rejects.toBeInstanceOf(ReviewAnalyzerExecutionError);
    });

    it("rejects a run that exceeds the configured AI request budget", async () => {
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(vi.fn())]);

        await expect(executeReviewAnalyzers(codeChange, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }, {
            analyzerId: "deepseek",
            required: false,
            timeoutMs: 1_000,
            failureMode: "degrade",
        }], registry, { ...budget, maxAiRequestCount: 1 }))
            .rejects.toBeInstanceOf(ReviewAnalyzerExecutionError);
    });

    it("respects the configured analyzer concurrency limit", async () => {
        let active = 0;
        let maximumActive = 0;
        const analyze = vi.fn().mockImplementation(async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return { summary: "Completed.", findings: [] };
        });
        const registry = new StaticReviewAnalyzerRegistry([
            createNamedAnalyzer("ai-one", analyze),
            createNamedAnalyzer("ai-two", analyze),
        ]);

        await executeReviewAnalyzers(codeChange, [{
            analyzerId: "ai-one",
            required: false,
            timeoutMs: 1_000,
            failureMode: "degrade",
        }, {
            analyzerId: "ai-two",
            required: false,
            timeoutMs: 1_000,
            failureMode: "degrade",
        }], registry, { ...budget, maxConcurrency: 1 });

        expect(maximumActive).toBe(1);
    });

    it("rejects duplicate analyzer identifiers during registration", () => {
        expect(() => new StaticReviewAnalyzerRegistry([
            createAnalyzer(vi.fn()),
            createAnalyzer(vi.fn()),
        ])).toThrow("identifiers must be unique");
    });
});
