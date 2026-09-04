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
import type {SemanticImpactIndexPort} from "../ports/semantic-impact-index-port.js";
import type {TestInventoryPort} from "../ports/test-inventory-port.js";
import type {TestExecutionEvidencePort} from "../ports/test-execution-evidence-port.js";
import {createImpactPackage} from "../changes/create-impact-package.js";

/** 对已获取代码变更执行统一分析器集合所需的外部能力。 */
export interface ReviewCodeChangeDependencies {
    reviewAnalyzerRegistry: ReviewAnalyzerRegistry;
    analyzerPlans: readonly AnalyzerExecutionPlan[];
    analyzerBudget: ReviewRunBudget;
    findingVerifiers: readonly FindingVerifier[];
    /** 可选的人工作废反馈读取端口；只允许抑制 AI advisory。 */
    findingSuppressionPort?: FindingSuppressionPort;
    /** 可选的本地静态影响索引；失败必须降级，不能中断评审。 */
    semanticImpactIndex?: SemanticImpactIndexPort;
    /** 可选的已提交测试资产发现；不能执行仓库脚本或制造覆盖证明。 */
    testInventory?: TestInventoryPort;
    /** 可选的受控沙箱通过证明；失败或不可用不得伪造覆盖。 */
    testExecutionEvidence?: TestExecutionEvidencePort;
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
    let impactPackage;
    let testInventory;
    let passedTestIds: readonly string[] = [];
    if (dependencies.testInventory !== undefined) {
        try {
            testInventory = await dependencies.testInventory.discover(
                AbortSignal.timeout(dependencies.analyzerBudget.totalTimeoutMs),
            );
        } catch {
            testInventory = {status: "unavailable" as const, frameworks: [], assetCount: 0, staticReferences: []};
        }
    }
    if (dependencies.testExecutionEvidence !== undefined) {
        try {
            passedTestIds = await dependencies.testExecutionEvidence.readPassedTestIds(
                AbortSignal.timeout(dependencies.analyzerBudget.totalTimeoutMs),
            );
        } catch {
            // 未通过验签、revision 校验或读取失败时，保持没有执行证明。
        }
    }
    if (dependencies.semanticImpactIndex !== undefined) {
        try {
            const result = await dependencies.semanticImpactIndex.analyze(
                command.reviewInput.rawCodeChange,
                command.reviewInput.codeChange,
                AbortSignal.timeout(dependencies.analyzerBudget.totalTimeoutMs),
            );
            impactPackage = createImpactPackage(result.relations, result.limitations, testInventory, passedTestIds);
        } catch {
            impactPackage = createImpactPackage([], ["impact-index-unavailable"], testInventory, passedTestIds);
        }
    }
    const execution = await executeReviewAnalyzers(
        command.reviewInput,
        dependencies.analyzerPlans,
        dependencies.reviewAnalyzerRegistry,
        dependencies.analyzerBudget,
        impactPackage,
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
