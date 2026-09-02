import {describe, expect, it, vi} from "vitest";
import {
    AiReviewExecutionError,
    AiReviewFailure,
    ReviewAnalyzerExecutionError,
} from "../../../../src/application/review/errors/review-execution-error.js";
import {executeReviewAnalyzers} from "../../../../src/application/review/orchestration/execute-review-analyzers.js";
import {
    StaticReviewAnalyzerRegistry
} from "../../../../src/application/review/orchestration/static-review-analyzer-registry.js";

const budget = {
    totalTimeoutMs: 1_000,
    maxConcurrency: 2,
    maxAiRequestCount: 2,
    maxModelInputChars: 10_000,
};

const codeChange = {
    diff: "",
    files: [],
    chunks: [],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

const reviewInput = {
    rawCodeChange: { fileChanges: [] },
    codeChange,
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

        const result = await executeReviewAnalyzers(reviewInput, [{
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
        expect(result.runs).toContainEqual(expect.objectContaining({
            analyzer: {kind: "ai", id: "optional-linter"},
            failureReason: "not-registered",
        }));
    });

    it("preserves classified AI failures for required analyzers", async () => {
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(
            vi.fn().mockRejectedValue(new AiReviewFailure("rate-limit", "Rate limited.")),
        )]);

        await expect(executeReviewAnalyzers(reviewInput, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], registry, budget)).rejects.toBeInstanceOf(AiReviewExecutionError);
    });

    it("retries only transient classified AI failures within the plan limit", async () => {
        const analyze = vi.fn()
            .mockRejectedValueOnce(new AiReviewFailure("rate-limit", "Retry later."))
            .mockRejectedValueOnce(new AiReviewFailure("timeout", "Timed out."))
            .mockResolvedValue({ summary: "Completed after retry.", findings: [] });
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(analyze)]);

        const result = await executeReviewAnalyzers(reviewInput, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            retryCount: 2,
            failureMode: "fail",
        }], registry, { ...budget, maxAiRequestCount: 3 });

        expect(analyze).toHaveBeenCalledTimes(3);
        expect(result.runs).toEqual([expect.objectContaining({
            status: "completed",
            attempts: 3,
        })]);
    });

    it("does not retry non-transient AI failures", async () => {
        const analyze = vi.fn().mockRejectedValue(new AiReviewFailure("authentication", "Invalid key."));
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(analyze)]);

        const result = await executeReviewAnalyzers(reviewInput, [{
            analyzerId: "deepseek",
            required: false,
            timeoutMs: 1_000,
            retryCount: 2,
            failureMode: "degrade",
        }], registry, { ...budget, maxAiRequestCount: 3 });

        expect(analyze).toHaveBeenCalledTimes(1);
        expect(result.runs).toEqual([expect.objectContaining({
            status: "degraded",
            attempts: 1,
            failureReason: "authentication",
        })]);
    });

    it("fails a required unregistered analyzer with a generic analyzer error", async () => {
        await expect(executeReviewAnalyzers(reviewInput, [{
            analyzerId: "typescript",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], new StaticReviewAnalyzerRegistry([]), budget)).rejects.toBeInstanceOf(ReviewAnalyzerExecutionError);
    });

    it("rejects a run that exceeds the configured AI request budget", async () => {
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(vi.fn())]);

        await expect(executeReviewAnalyzers(reviewInput, [{
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

    it("includes planned AI retries in the request budget", async () => {
        const registry = new StaticReviewAnalyzerRegistry([createAnalyzer(vi.fn())]);

        await expect(executeReviewAnalyzers(reviewInput, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            retryCount: 2,
            failureMode: "fail",
        }], registry, { ...budget, maxAiRequestCount: 2 }))
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

        await executeReviewAnalyzers(reviewInput, [{
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

    it("passes raw input only to trusted local analyzers", async () => {
        const remoteAnalyze = vi.fn().mockResolvedValue({ summary: "Remote.", findings: [] });
        const localAnalyze = vi.fn().mockResolvedValue({ summary: "Local.", findings: [] });
        const registry = new StaticReviewAnalyzerRegistry([
            createAnalyzer(remoteAnalyze),
            {
                identity: { kind: "secret-scan" as const, id: "secret-scan" },
                capabilities: {
                    inputAccess: "trusted-raw-local" as const,
                    supportsChangedOnly: true,
                    supportsRepositoryScan: false,
                },
                analyze: localAnalyze,
            },
        ]);
        const trustedInput = {
            rawCodeChange: {
                fileChanges: [{
                    file: { path: ".env", status: "added" as const },
                    diff: "+SECRET=raw-value\n",
                }],
            },
            codeChange,
        };

        await executeReviewAnalyzers(trustedInput, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }, {
            analyzerId: "secret-scan",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], registry, budget);

        expect(remoteAnalyze.mock.calls[0]?.[0]).not.toHaveProperty("rawCodeChange");
        expect(localAnalyze.mock.calls[0]?.[0]).toMatchObject({
            rawCodeChange: trustedInput.rawCodeChange,
        });
    });

    it("rejects an AI analyzer that incorrectly requests raw input", async () => {
        const registry = new StaticReviewAnalyzerRegistry([{
            identity: { kind: "ai" as const, id: "unsafe-ai" },
            capabilities: {
                inputAccess: "trusted-raw-local" as const,
                supportsChangedOnly: true,
                supportsRepositoryScan: false,
            },
            analyze: vi.fn(),
        }]);

        await expect(executeReviewAnalyzers(reviewInput, [{
            analyzerId: "unsafe-ai",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], registry, budget)).rejects.toBeInstanceOf(ReviewAnalyzerExecutionError);
    });

    it("applies the model input budget only to sanitized AI requests", async () => {
        const aiAnalyze = vi.fn().mockResolvedValue({ summary: "AI.", findings: [] });
        const localAnalyze = vi.fn().mockResolvedValue({ summary: "Local.", findings: [] });
        const registry = new StaticReviewAnalyzerRegistry([
            createAnalyzer(aiAnalyze),
            {
                identity: { kind: "secret-scan" as const, id: "secret-scan" },
                capabilities: {
                    inputAccess: "trusted-raw-local" as const,
                    supportsChangedOnly: true,
                    supportsRepositoryScan: false,
                },
                analyze: localAnalyze,
            },
        ]);
        const largeInput = {
            rawCodeChange: { fileChanges: [] },
            codeChange: {
                ...codeChange,
                files: [
                    { path: "src/first.ts", status: "modified" as const },
                    { path: "src/second.ts", status: "modified" as const },
                ],
                chunks: [
                    { id: "first", path: "src/first.ts", content: "a".repeat(80) },
                    { id: "second", path: "src/second.ts", content: "b".repeat(80) },
                ],
            },
        };

        await executeReviewAnalyzers(largeInput, [{
            analyzerId: "deepseek",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }, {
            analyzerId: "secret-scan",
            required: true,
            timeoutMs: 1_000,
            failureMode: "fail",
        }], registry, { ...budget, maxModelInputChars: 140 });

        expect(aiAnalyze.mock.calls[0]?.[0].codeChange.chunks).toHaveLength(1);
        expect(localAnalyze.mock.calls[0]?.[0].codeChange.chunks).toHaveLength(2);
    });
});
