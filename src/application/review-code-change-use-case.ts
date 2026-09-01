import type { AiReviewPort } from "./ports/ai-review-port.js";
import type { CodeChange } from "../domain/review/code-change.js";
import type { ReviewAnalysis } from "../domain/review/review-finding.js";
import {
    evaluateReviewPolicy,
    type ReviewPolicyDecision,
} from "../domain/review/review-policy.js";
import type { Severity } from "../domain/review/severity.js";
import {
    AiReviewFailure,
    AiReviewExecutionError,
} from "./review-execution-error.js";

/** 对已获取代码变更执行 AI 评审所需的外部能力。 */
export interface ReviewCodeChangeDependencies {
    aiReviewPort: AiReviewPort;
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
        analysis = await dependencies.aiReviewPort.review(command.codeChange);
    } catch (error) {
        const failureType = error instanceof AiReviewFailure
            ? error.failureType
            : "unknown";
        throw new AiReviewExecutionError(failureType, error);
    }

    return {
        codeChange: command.codeChange,
        analysis,
        policy: evaluateReviewPolicy(analysis.findings, command.failOn),
    };
};
