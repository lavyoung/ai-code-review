import type { ReviewFinding } from "./review-finding.js";
import type { AnalyzerIdentity } from "./analyzer-identity.js";

/** 候选发现项被锚定或验证后的状态。 */
export type FindingVerificationStatus = "grounded" | "verified";

/** AI 或其他分析器提出、尚未验证的评审候选项。 */
export interface ReviewCandidate extends ReviewFinding {
    /** 执行器写入的来源；模型或外部工具不得自行声明。 */
    analyzer?: AnalyzerIdentity;
    /** 模型必须引用的已脱敏 diff 分块标识。 */
    chunkId?: string;
    /** 能在该分块中精确匹配的简短、已脱敏代码片段。 */
    evidence?: string;
}

/** 完成变更锚定与证据一致性校验后可对外输出的发现项。 */
export interface ValidatedFinding extends ReviewFinding {
    chunkId: string;
    evidence: string;
    verificationStatus: FindingVerificationStatus;
    verificationMethods: FindingVerificationMethod[];
    analyzer?: AnalyzerIdentity;
}

/** 最终发现项获得验证状态的可审计方法。 */
export type FindingVerificationMethod = "diff-anchor" | "evidence-match" | "deterministic-analyzer";

/** 因安全或证据不足而不对外输出的候选项原因。 */
export type CandidateSuppressionReason =
    | "missing-chunk-reference"
    | "unknown-chunk"
    | "location-mismatch"
    | "missing-evidence"
    | "evidence-mismatch";

/** 验证步骤对候选项的安全结果。 */
export interface CandidateValidationResult {
    findings: ValidatedFinding[];
    suppressedCounts: Partial<Record<CandidateSuppressionReason, number>>;
}
