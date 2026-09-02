import type { ReviewRunRecordPort, SanitizedReviewRunRecord } from "../ports/review-run-record-port.js";

/** 运行记录投递结果只暴露安全状态。 */
export type ReviewRunRecordingStatus = "delivered" | "failed";

/** 持久化失败不影响评审或质量门禁，仅返回安全状态供接口层输出。 */
export const recordReviewRunUseCase = async (
    record: SanitizedReviewRunRecord,
    recorder: ReviewRunRecordPort,
): Promise<ReviewRunRecordingStatus> => {
    try {
        await recorder.append(record);
        return "delivered";
    } catch {
        return "failed";
    }
};
