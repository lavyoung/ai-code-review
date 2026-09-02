import type { ReviewExecutionResult } from "../use-cases/review-code-change-use-case.js";
import type { SanitizedReviewRunRecord } from "../ports/review-run-record-port.js";

/** 将评审执行结果投影为可安全保存和后续反馈关联的运行记录。 */
export const createSanitizedReviewRunRecord = (
    runId: string,
    result: ReviewExecutionResult,
    recordedAt: string = new Date().toISOString(),
): SanitizedReviewRunRecord => ({
    schemaVersion: "v1",
    runId,
    recordedAt,
    qualityGateFailed: result.policy.shouldFail,
    highestSeverity: result.policy.highestSeverity,
    analyzerRuns: result.analyzerRuns.map((run) => ({
        analyzerId: `${run.analyzer.kind}:${run.analyzer.id}`,
        status: run.status,
        durationMs: run.durationMs,
    })),
    findings: result.findings.map((finding) => ({
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        verificationStatus: finding.verificationStatus,
        analyzerIds: finding.analyzers.map((analyzer) => `${analyzer.kind}:${analyzer.id}`),
    })),
});
