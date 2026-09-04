import type {ReviewChangeInput} from "../../../domain/review/model/code-change.js";
import {boundSanitizedModelInput} from "../changes/bound-sanitized-model-input.js";
import {boundImpactPackage} from "../changes/bound-impact-package.js";
import type {AnalyzerIdentity} from "../../../domain/review/model/analyzer-identity.js";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {ImpactPackage} from "../../../domain/impact/model/impact-package.js";
import {
    AiReviewExecutionError,
    AiReviewFailure,
    ReviewAnalyzerExecutionError,
} from "../errors/review-execution-error.js";
import type {
    AnalyzerExecutionPlan,
    AnalyzerRun,
    ReviewAnalyzerRegistry,
    ReviewRunBudget,
} from "../ports/review-analyzer-port.js";

/** 多分析器执行后可供评审用例消费的安全结果。 */
export interface ReviewAnalyzerExecutionResult {
    analysis: ReviewAnalysis;
    runs: AnalyzerRun[];
}

interface CompletedAnalysis {
    analysis: ReviewAnalysis;
    analyzer: AnalyzerIdentity;
}

const RETRYABLE_AI_FAILURE_TYPES = new Set<AiReviewFailure["failureType"]>([
    "request",
    "rate-limit",
    "timeout",
]);

const getRetryCount = (plan: AnalyzerExecutionPlan): number => {
    const retryCount = plan.retryCount ?? 0;

    if (!Number.isInteger(retryCount) || retryCount < 0) {
        throw new ReviewAnalyzerExecutionError(plan.analyzerId, new Error("Analyzer retry count is invalid."));
    }

    return retryCount;
};

const isRetryableFailure = (error: unknown, signal: AbortSignal): boolean => !signal.aborted
    && error instanceof AiReviewFailure
    && RETRYABLE_AI_FAILURE_TYPES.has(error.failureType);

/** 将任意适配器异常收敛为可安全出现在报告与运行记录中的原因码。 */
const getSafeFailureReason = (
    error: unknown,
): NonNullable<AnalyzerRun["failureReason"]> => error instanceof AiReviewFailure
    ? error.failureType
    : "execution";

const mergeAnalyses = (analyses: readonly CompletedAnalysis[]): ReviewAnalysis => ({
    summary: analyses.length === 1
        ? analyses[0]?.analysis.summary ?? "No analyzer completed."
        : analyses.length === 0
            ? "No analyzer completed."
            : analyses.map(({ analysis }) => analysis.summary).join("\n\n"),
    // 来源只由受控执行器标记，外部分析器输出不能伪造确定性身份。
    findings: analyses.flatMap(({ analysis, analyzer }) => analysis.findings.map((finding) => ({
        ...finding,
        analyzer,
    }))),
});

/**
 * 按执行计划运行已注册分析器并隔离 advisory 失败。
 *
 * 当前阶段每个计划独立执行；后续并发预算调度可以保持该输入/输出契约不变。
 */
export const executeReviewAnalyzers = async (
    reviewInput: ReviewChangeInput,
    plans: readonly AnalyzerExecutionPlan[],
    registry: ReviewAnalyzerRegistry,
    budget: ReviewRunBudget,
    impactPackage?: ImpactPackage,
): Promise<ReviewAnalyzerExecutionResult> => {
    const analyses: CompletedAnalysis[] = [];
    const runs: AnalyzerRun[] = [];
    const globalTimeout = AbortSignal.timeout(budget.totalTimeoutMs);
    const executablePlans = plans;
    const aiPlanCount = executablePlans.reduce((total, plan) =>
        registry.resolve(plan.analyzerId)?.identity.kind === "ai"
            ? total + getRetryCount(plan) + 1
            : total, 0);

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
                    attempts: 0,
                    failureReason: "not-registered",
                    durationMs: 0,
                });
                continue;
            }

            if (analyzer.identity.kind === "ai"
                && analyzer.capabilities.inputAccess !== "sanitized-model-input") {
                throw new ReviewAnalyzerExecutionError(
                    analyzer.identity.id,
                    new Error("AI analyzers must use sanitized model input."),
                );
            }

            const startedAt = Date.now();
            let attempts = 0;
            const planSignal = AbortSignal.any([globalTimeout, AbortSignal.timeout(plan.timeoutMs)]);
            try {
                const modelInputBudget = Math.floor(budget.maxModelInputChars * 0.75);
                const codeChange = analyzer.capabilities.inputAccess === "sanitized-model-input"
                    ? boundSanitizedModelInput(
                        reviewInput.codeChange,
                        modelInputBudget,
                    )
                    : reviewInput.codeChange;
                const boundedImpactPackage = analyzer.capabilities.inputAccess === "sanitized-model-input"
                    && impactPackage !== undefined
                    ? boundImpactPackage(
                        impactPackage,
                        new Set(codeChange.chunks.map((chunk) => chunk.id)),
                        budget.maxModelInputChars - modelInputBudget,
                    )
                    : impactPackage;
                let analysis: ReviewAnalysis | undefined;
                const maxAttempts = getRetryCount(plan) + 1;
                for (attempts = 1; attempts <= maxAttempts; attempts += 1) {
                    try {
                        analysis = await analyzer.analyze({
                            codeChange,
                            signal: planSignal,
                            ...(boundedImpactPackage === undefined ? {} : {impactPackage: boundedImpactPackage}),
                            ...(analyzer.capabilities.inputAccess === "trusted-raw-local"
                                ? { rawCodeChange: reviewInput.rawCodeChange }
                                : {}),
                        });
                        break;
                    } catch (error) {
                        if (attempts === maxAttempts || !isRetryableFailure(error, planSignal)) {
                            throw error;
                        }
                    }
                }
                if (analysis === undefined) {
                    throw new Error("Analyzer retry loop did not complete.");
                }
                analyses.push({ analysis, analyzer: analyzer.identity });
                runs.push({
                    analyzer: analyzer.identity,
                    status: "completed",
                    attempts,
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
                    attempts,
                    failureReason: getSafeFailureReason(error),
                    durationMs,
                });
            }
        }
    };

    const workerCount = Math.min(budget.maxConcurrency, executablePlans.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return { analysis: mergeAnalyses(analyses), runs };
};
