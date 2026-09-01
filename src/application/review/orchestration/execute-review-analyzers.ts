import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";
import {
    AiReviewFailure,
    AiReviewExecutionError,
    ReviewAnalyzerExecutionError,
} from "../errors/review-execution-error.js";
import type {
    AnalyzerExecutionPlan,
    AnalyzerRun,
    ReviewRunBudget,
    ReviewAnalyzerRegistry,
} from "../ports/review-analyzer-port.js";

/** 多分析器执行后可供评审用例消费的安全结果。 */
export interface ReviewAnalyzerExecutionResult {
    analysis: ReviewAnalysis;
    runs: AnalyzerRun[];
}

const mergeAnalyses = (analyses: readonly ReviewAnalysis[]): ReviewAnalysis => ({
    summary: analyses.length === 1
        ? analyses[0]?.summary ?? "No analyzer completed."
        : analyses.length === 0
            ? "No analyzer completed."
            : analyses.map((analysis) => analysis.summary).join("\n\n"),
    findings: analyses.flatMap((analysis) => analysis.findings),
});

/**
 * 按执行计划运行已注册分析器并隔离 advisory 失败。
 *
 * 当前阶段每个计划独立执行；后续并发预算调度可以保持该输入/输出契约不变。
 */
export const executeReviewAnalyzers = async (
    codeChange: CodeChange,
    plans: readonly AnalyzerExecutionPlan[],
    registry: ReviewAnalyzerRegistry,
    budget: ReviewRunBudget,
): Promise<ReviewAnalyzerExecutionResult> => {
    const analyses: ReviewAnalysis[] = [];
    const runs: AnalyzerRun[] = [];
    const globalTimeout = AbortSignal.timeout(budget.totalTimeoutMs);
    const executablePlans = plans;
    const aiPlanCount = executablePlans.filter((plan) => registry.resolve(plan.analyzerId)?.identity.kind === "ai").length;

    if (aiPlanCount > budget.maxAiRequestCount) {
        throw new ReviewAnalyzerExecutionError("review-run", new Error("AI request budget exceeded."));
    }

    let nextPlanIndex = 0;
    const runWorker = async (): Promise<void> => {
        while (true) {
            const plan = executablePlans[nextPlanIndex++];
            if (plan === undefined) {
                return;
            }

            const analyzer = registry.resolve(plan.analyzerId);
            if (analyzer === undefined) {
                if (plan.required && plan.failureMode === "fail") {
                    throw new ReviewAnalyzerExecutionError(plan.analyzerId, new Error("Analyzer is not registered."));
                }

                runs.push({
                    analyzer: { kind: "ai", id: plan.analyzerId },
                    status: "degraded",
                    durationMs: 0,
                });
                continue;
            }

            const startedAt = Date.now();
            try {
                const analysis = await analyzer.analyze({
                    codeChange,
                    signal: AbortSignal.any([globalTimeout, AbortSignal.timeout(plan.timeoutMs)]),
                });
                analyses.push(analysis);
                runs.push({
                    analyzer: analyzer.identity,
                    status: "completed",
                    durationMs: Date.now() - startedAt,
                });
            } catch (error) {
                const durationMs = Date.now() - startedAt;
                if (plan.required && plan.failureMode === "fail") {
                    if (error instanceof AiReviewFailure) {
                        throw new AiReviewExecutionError(error.failureType, error);
                    }

                    if (analyzer.identity.kind === "ai") {
                        throw new AiReviewExecutionError("unknown", error);
                    }

                    throw new ReviewAnalyzerExecutionError(analyzer.identity.id, error);
                }

                runs.push({
                    analyzer: analyzer.identity,
                    status: "degraded",
                    durationMs,
                });
            }
        }
    };

    const workerCount = Math.min(budget.maxConcurrency, executablePlans.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return { analysis: mergeAnalyses(analyses), runs };
};
