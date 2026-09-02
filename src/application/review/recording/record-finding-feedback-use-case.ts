import { randomUUID } from "node:crypto";
import type {
    FindingFeedbackStatus,
    ReviewFeedbackPort,
    SanitizedFindingFeedback,
} from "../ports/review-run-record-port.js";

/** 通过稳定发现指纹记录人工反馈的输入。 */
export interface RecordFindingFeedbackCommand {
    fingerprint: string;
    status: FindingFeedbackStatus;
    runId?: string;
}

/** 创建不含自由文本或仓库数据的人工反馈事件。 */
export const createSanitizedFindingFeedback = (
    command: RecordFindingFeedbackCommand,
    recordedAt: string = new Date().toISOString(),
    feedbackId: string = randomUUID(),
): SanitizedFindingFeedback => ({
    schemaVersion: "v1",
    recordType: "finding-feedback",
    feedbackId,
    fingerprint: command.fingerprint,
    status: command.status,
    recordedAt,
    ...(command.runId === undefined ? {} : { runId: command.runId }),
});

/** 反馈记录失败不会泄露底层存储细节。 */
export const recordFindingFeedbackUseCase = async (
    feedback: SanitizedFindingFeedback,
    recorder: ReviewFeedbackPort,
): Promise<"delivered" | "failed"> => {
    try {
        await recorder.appendFeedback(feedback);
        return "delivered";
    } catch {
        return "failed";
    }
};
