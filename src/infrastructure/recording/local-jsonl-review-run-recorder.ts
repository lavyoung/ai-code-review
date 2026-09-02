import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
    ReviewFeedbackPort,
    ReviewRunRecordPort,
    SanitizedFindingFeedback,
    SanitizedReviewRunRecord,
} from "../../application/review/ports/review-run-record-port.js";

/** 将脱敏运行记录追加为 UTF-8 JSON Lines，便于 CI 作为 artifact 保留。 */
export class LocalJsonlReviewRunRecorder implements ReviewRunRecordPort, ReviewFeedbackPort {
    public constructor(private readonly path: string) {}

    public async append(record: SanitizedReviewRunRecord): Promise<void> {
        await this.appendJsonLine(record);
    }

    public async appendFeedback(feedback: SanitizedFindingFeedback): Promise<void> {
        await this.appendJsonLine(feedback);
    }

    private async appendJsonLine(record: SanitizedReviewRunRecord | SanitizedFindingFeedback): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
    }
}
