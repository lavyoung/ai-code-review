import type { AiReviewPort } from "./ports/ai-review-port.js";
import type { DiffProvider } from "./ports/diff-provider.js";
import { resolveManualCodeChange } from "./resolve-manual-code-change.js";
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
    DiffResolutionError,
} from "./review-execution-error.js";

/**
 * 手动评审用例所需的外部能力。
 */
export interface RunManualReviewDependencies {
    diffProvider: DiffProvider;
    aiReviewPort: AiReviewPort;
}

/**
 * 执行一次手动评审所需的输入。
 */
export interface RunManualReviewCommand {
    target: string;
    failOn: readonly Severity[];
}

/**
 * 手动评审用例的完整执行结果。
 */
export interface ManualReviewResult {
    codeChange: CodeChange;
    analysis: ReviewAnalysis;
    policy: ReviewPolicyDecision;
}

/**
 * 编排手动评审：读取安全 diff、调用 AI、应用质量门禁。
 */
export const runManualReviewUseCase = async (
    command: RunManualReviewCommand,
    dependencies: RunManualReviewDependencies,
): Promise<ManualReviewResult> => {
    let codeChange: CodeChange;
    try {
        codeChange = await resolveManualCodeChange(
            dependencies.diffProvider,
            command.target,
        );
    } catch (error) {
        throw new DiffResolutionError(error);
    }

    let analysis: ReviewAnalysis;
    try {
        analysis = await dependencies.aiReviewPort.review(codeChange);
    } catch (error) {
        const failureType = error instanceof AiReviewFailure
            ? error.failureType
            : "unknown";
        throw new AiReviewExecutionError(failureType, error);
    }

    return {
        codeChange,
        analysis,
        policy: evaluateReviewPolicy(analysis.findings, command.failOn),
    };
};
