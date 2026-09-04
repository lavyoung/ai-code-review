import type {ReviewFinding} from "./review-finding.js";
import type {AnalyzerIdentity} from "./analyzer-identity.js";

/** 候选发现项被锚定或验证后的状态。 */
export type FindingVerificationStatus =
    /** 兼容历史运行记录；新发现必须使用 `anchored`。 */
    | "grounded"
    /** 已锚定到本次变更，但尚未证明结论。 */
    | "anchored"
    /** 多个独立受控来源支持，仍不能单独触发门禁。 */
    | "corroborated"
    /** 满足系统定义的确定性验证要求。 */
    | "verified"
    /** 所需上下文或验证证据不可用。 */
    | "unavailable";

/** 对外呈现的处置级别；AI 建议不能伪装为已确认缺陷。 */
export type FindingDisposition = "advisory" | "defect" | "unverifiable";

/** 系统受控的断言类别；不同类别拥有不同的验证策略。 */
export const ASSERTION_TYPES = [
    "impact-closure",
    "regression-risk",
    "contract-compatibility",
    "test-obligation",
    "security-risk",
    "design-maintainability",
] as const;

export type AssertionType = typeof ASSERTION_TYPES[number];

/** 可审计事实的最小安全表达，不保存原始 diff。 */
export interface ReviewFact {
    id: string;
    kind: "diff-anchor" | "source-range" | "evidence-match" | "deterministic-analyzer";
    source: "candidate-validation" | "deterministic-analyzer";
    verification: "confirmed" | "unavailable" | "inconclusive";
}

/** AI 或规则提出的主张；验证要求只能由系统策略写入。 */
export interface ReviewAssertion {
    type: AssertionType;
    author: "ai" | "rule";
    factIds: readonly string[];
    uncertainty: "none" | "context-limited" | "external-fact-required";
}

/** AI 或其他分析器提出、尚未验证的评审候选项。 */
export interface ReviewCandidate extends ReviewFinding {
    /** 执行器写入的来源；模型或外部工具不得自行声明。 */
    analyzer?: AnalyzerIdentity;
    /** 模型必须引用的已脱敏 diff 分块标识。 */
    chunkId?: string;
    /** 能在该分块中精确匹配的简短、已脱敏代码片段。 */
    evidence?: string;
    /** 模型可建议分类；系统策略决定验证要求、处置和门禁资格。 */
    assertionType?: AssertionType;
}

/** 完成变更锚定与证据一致性校验后可对外输出的发现项。 */
export interface ValidatedFinding extends ReviewFinding {
    /** 仅由已脱敏定位和规范化语义生成的稳定发现标识。 */
    fingerprint: string;
    chunkId: string;
    evidence: string;
    verificationStatus: FindingVerificationStatus;
    /** `verified` 的确定性结果才可作为 `defect` 处置。 */
    disposition: FindingDisposition;
    verificationMethods: FindingVerificationMethod[];
    /** 阶段 A 写入的系统事实；旧记录可能不存在。 */
    facts?: readonly ReviewFact[];
    /** 阶段 A 写入的系统断言；旧记录可能不存在。 */
    assertion?: ReviewAssertion;
    analyzer?: AnalyzerIdentity;
    /** 产生或确认同一发现的受控分析器来源。 */
    analyzers: AnalyzerIdentity[];
}

/** 最终发现项获得验证状态的可审计方法。 */
export type FindingVerificationMethod =
    | "diff-anchor"
    | "source-range"
    | "evidence-match"
    | "ast"
    | "test-execution"
    | "deterministic-analyzer";

/** 因安全或证据不足而不对外输出的候选项原因。 */
export type CandidateSuppressionReason =
    | "missing-chunk-reference"
    | "unknown-chunk"
    | "location-mismatch"
    | "missing-evidence"
    | "evidence-mismatch"
    | "redacted-dependency"
    | "feedback-suppressed";

/** 验证步骤对候选项的安全结果。 */
export interface CandidateValidationResult {
    findings: ValidatedFinding[];
    suppressedCounts: Partial<Record<CandidateSuppressionReason, number>>;
}
