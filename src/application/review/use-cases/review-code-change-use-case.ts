import type { ReviewAnalyzer } from "../ports/review-analyzer-port.js";
import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";
import type {
    CandidateValidationResult,
    ValidatedFinding,
} from "../../../domain/review/model/review-candidate.js";
import { validateReviewCandidates } from "../../../domain/review/policy/validate-review-candidates.js";
import {
    evaluateReviewPolicy,
    type ReviewPolicyDecision,
} from "../../../domain/review/policy/review-policy.js";
import type { Severity } from "../../../domain/review/model/severity.js";
import {
    AiReviewFailure,
    AiReviewExecutionError,
} from "../errors/review-execution-error.js";

/** 对已获取代码变更执行 AI 评审所需的外部能力。 */
export interface ReviewCodeChangeDependencies {
    reviewAnalyzer: ReviewAnalyzer;
}

/** 对已过滤、已脱敏代码变更执行评审的输入。 */
export interface ReviewCodeChangeCommand {
    codeChange: CodeChange;
    failOn: readonly Severity[];
}

/** 不依赖触发平台的评审执行结果。 */
export interface ReviewExecutionResult {
    codeChange: CodeChange;
    analysis: ReviewAnalysis;
    /** 已锚定到本次变更、可安全输出的发现项。 */
    findings: ValidatedFinding[];
    /** 因缺少安全证据而被过滤的候选项计数。 */
    suppressedCandidateCounts: CandidateValidationResult["suppressedCounts"];
    policy: ReviewPolicyDecision;
}

/**
 * 调用 AI 并应用质量门禁；Git 平台、事件环境和通知渠道均位于调用方边界之外。
 */
export const reviewCodeChangeUseCase = async (
    command: ReviewCodeChangeCommand,
    dependencies: ReviewCodeChangeDependencies,
): Promise<ReviewExecutionResult> => {
    let analysis: ReviewAnalysis;
    try {
        analysis = await dependencies.reviewAnalyzer.analyze({ codeChange: command.codeChange });
    } catch (error) {
        const failureType = error instanceof AiReviewFailure
            ? error.failureType
            : "unknown";
        throw new AiReviewExecutionError(failureType, error);
    }

    const validation = validateReviewCandidates(analysis.findings, command.codeChange);

    return {
        codeChange: command.codeChange,
        analysis,
        findings: validation.findings,
        suppressedCandidateCounts: validation.suppressedCounts,
        policy: evaluateReviewPolicy(validation.findings, command.failOn),
    };
};
