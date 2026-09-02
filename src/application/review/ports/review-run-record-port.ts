import type { Severity } from "../../../domain/review/model/severity.js";
import type { FindingVerificationStatus } from "../../../domain/review/model/review-candidate.js";

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
    runId: string;
    recordedAt: string;
    qualityGateFailed: boolean;
    highestSeverity: Severity | null;
    analyzerRuns: Array<{ analyzerId: string; status: "completed" | "degraded" | "failed"; durationMs: number }>;
    findings: SanitizedRecordedFinding[];
}

/** 运行记录持久化端口；实现不得保存原始 diff 或敏感内容。 */
export interface ReviewRunRecordPort {
    append(record: SanitizedReviewRunRecord): Promise<void>;
}
