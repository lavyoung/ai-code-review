import type { ReviewFinding } from "../model/review-finding.js";
import type { Severity } from "../model/severity.js";

const severityRanks: Record<Severity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

/**
 * 评审发现项经过质量门禁规则判定后的结果。
 */
export interface ReviewPolicyDecision {
    highestSeverity: Severity | null;
    shouldFail: boolean;
}

/**
 * 根据配置的 `fail_on` 严重级别计算质量门禁结果。
 *
 * @param findings AI 输出的结构化发现项。
 * @param failOn 会使流水线失败的严重级别集合。
 * @returns 最高严重级别与是否阻断流水线。
 */
export const evaluateReviewPolicy = (
    findings: readonly ReviewFinding[],
    failOn: readonly Severity[],
): ReviewPolicyDecision => {
    const highestSeverity = findings.reduce<Severity | null>(
        (current, finding) => current === null || severityRanks[finding.severity] > severityRanks[current]
            ? finding.severity
            : current,
        null,
    );

    return {
        highestSeverity,
        shouldFail: findings.some((finding) => failOn.includes(finding.severity)),
    };
};
