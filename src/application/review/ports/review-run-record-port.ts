import type {Severity} from "../../../domain/review/model/severity.js";
import type {FindingVerificationStatus} from "../../../domain/review/model/review-candidate.js";
import type {AnalyzerFailureReason} from "./review-analyzer-port.js";

/** 可持久化的安全发现摘要，不含路径、文本、diff 或证据内容。 */
export interface SanitizedRecordedFinding {
    fingerprint: string;
    severity: Severity;
    verificationStatus: FindingVerificationStatus;
    analyzerIds: string[];
}

/** 可由本地文件或组织受控服务保存的脱敏评审运行记录。 */
export interface SanitizedReviewRunRecord {
    schemaVersion: "v1";
    recordType: "review-run";
    runId: string;
    recordedAt: string;
    qualityGateFailed: boolean;
    highestSeverity: Severity | null;
    analyzerRuns: Array<{
        analyzerId: string;
        status: "completed" | "degraded" | "failed";
        attempts: number;
        failureReason?: AnalyzerFailureReason;
        durationMs: number;
    }>;
    findings: SanitizedRecordedFinding[];
}

export const FINDING_FEEDBACK_STATUSES = [
    "accepted",
    "false-positive",
    "not-applicable",
    "fixed",
] as const;

export type FindingFeedbackStatus = (typeof FINDING_FEEDBACK_STATUSES)[number];

/** 人工对发现作出的脱敏反馈；不保存评论正文、路径或代码。 */
export interface SanitizedFindingFeedback {
    schemaVersion: "v1";
    recordType: "finding-feedback";
    feedbackId: string;
    fingerprint: string;
    status: FindingFeedbackStatus;
    recordedAt: string;
    runId?: string;
}

/** 可被安全质量度量读取的本地或远程事件联合类型。 */
export type SanitizedQualityRecord = SanitizedReviewRunRecord | SanitizedFindingFeedback;

/** 运行记录持久化端口；实现不得保存原始 diff 或敏感内容。 */
export interface ReviewRunRecordPort {
    append(record: SanitizedReviewRunRecord): Promise<void>;
}

/** 人工反馈持久化端口；可与运行记录使用同一安全存储实现。 */
export interface ReviewFeedbackPort {
    appendFeedback(feedback: SanitizedFindingFeedback): Promise<void>;
}

/**
 * 保存脱敏运行记录及人工反馈的质量存储。
 *
 * 实现只可处理此模块定义的安全事件，不能接收原始 diff、路径、代码或自由文本。
 */
export interface ReviewQualityStore extends ReviewRunRecordPort, ReviewFeedbackPort {
}
