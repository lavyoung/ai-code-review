import type {CodeChange, ReviewChangeInput} from "../../../domain/review/model/code-change.js";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {CandidateValidationResult, ValidatedFinding,} from "../../../domain/review/model/review-candidate.js";
import {validateReviewCandidates} from "../../../domain/review/policy/validate-review-candidates.js";
import {evaluateReviewPolicy, type ReviewPolicyDecision,} from "../../../domain/review/policy/review-policy.js";
import type {Severity} from "../../../domain/review/model/severity.js";
import type {
    AnalyzerExecutionPlan,
    AnalyzerRun,
    ReviewAnalyzerRegistry,
    ReviewRunBudget,
} from "../ports/review-analyzer-port.js";
import {executeReviewAnalyzers} from "../orchestration/execute-review-analyzers.js";
import {verifyReviewFindings} from "../orchestration/verify-review-findings.js";
import type {FindingVerifier} from "../ports/finding-verifier-port.js";
import {deduplicateReviewFindings} from "../orchestration/deduplicate-review-findings.js";
import type {FindingSuppressionPort} from "../ports/finding-suppression-port.js";

/** 对已获取代码变更执行统一分析器集合所需的外部能力。 */
export interface ReviewCodeChangeDependencies {
    reviewAnalyzerRegistry: ReviewAnalyzerRegistry;
    analyzerPlans: readonly AnalyzerExecutionPlan[];
    analyzerBudget: ReviewRunBudget;
    findingVerifiers: readonly FindingVerifier[];
    /** 可选的人工作废反馈读取端口；只允许抑制 AI advisory。 */
    findingSuppressionPort?: FindingSuppressionPort;
}

/** 对同一次受控原始/安全变更执行评审的输入。 */
export interface ReviewCodeChangeCommand {
    reviewInput: ReviewChangeInput;
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
    /** 各分析器的脱敏运行状态。 */
    analyzerRuns: AnalyzerRun[];
    policy: ReviewPolicyDecision;
}

/**
 * 调用已注册分析器并应用质量门禁；Git 平台、事件环境和通知渠道均位于调用方边界之外。
 */
export const reviewCodeChangeUseCase = async (
    command: ReviewCodeChangeCommand,
    dependencies: ReviewCodeChangeDependencies,
): Promise<ReviewExecutionResult> => {
    const execution = await executeReviewAnalyzers(
        command.reviewInput,
        dependencies.analyzerPlans,
        dependencies.reviewAnalyzerRegistry,
        dependencies.analyzerBudget,
    );
    const analysis: ReviewAnalysis = execution.analysis;

    const codeChange = command.reviewInput.codeChange;
    const validation = validateReviewCandidates(analysis.findings, codeChange);
    const verifiedFindings = verifyReviewFindings(
        validation.findings,
        codeChange,
        dependencies.findingVerifiers,
    );
    const deduplicatedFindings = deduplicateReviewFindings(verifiedFindings);
    const activeSuppressedFingerprints = dependencies.findingSuppressionPort === undefined
        ? new Set<string>()
        : new Set(await dependencies.findingSuppressionPort.getActiveSuppressedFingerprints());
    const feedbackSuppressedCount = deduplicatedFindings.filter((finding) =>
        finding.disposition === "advisory" && activeSuppressedFingerprints.has(finding.fingerprint),
    ).length;
    const findings = deduplicatedFindings.filter((finding) =>
        finding.disposition === "defect" || !activeSuppressedFingerprints.has(finding.fingerprint),
    );
    const suppressedCandidateCounts = {
        ...validation.suppressedCounts,
        ...(feedbackSuppressedCount === 0 ? {} : {"feedback-suppressed": feedbackSuppressedCount}),
    };

    return {
        codeChange,
        analysis,
        findings,
        suppressedCandidateCounts,
        analyzerRuns: execution.runs,
        policy: evaluateReviewPolicy(findings, command.failOn),
    };
};
