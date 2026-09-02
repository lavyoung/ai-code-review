import type {FindingSuppressionPort} from "../../application/review/ports/finding-suppression-port.js";
import type {SanitizedFindingFeedback} from "../../application/review/ports/review-run-record-port.js";
import {LocalJsonlReviewQualityRecordReader} from "./local-jsonl-review-quality-record-reader.js";

const suppressingStatuses = new Set<SanitizedFindingFeedback["status"]>([
    "false-positive",
    "not-applicable",
]);

const toTimestamp = (value: string): number => Date.parse(value);

const isLater = (
    candidate: SanitizedFindingFeedback,
    current: SanitizedFindingFeedback | undefined,
): boolean => current === undefined || toTimestamp(candidate.recordedAt) >= toTimestamp(current.recordedAt);

/**
 * 从本地脱敏反馈事件解析当前仍有效的 AI 建议抑制项。
 *
 * 新的 `accepted` 或 `fixed` 反馈会撤销抑制；过期反馈自动失效。
 */
export class LocalJsonlFindingSuppressionReader implements FindingSuppressionPort {
    private readonly recordReader: LocalJsonlReviewQualityRecordReader;

    public constructor(path: string) {
        this.recordReader = new LocalJsonlReviewQualityRecordReader(path);
    }

    public async getActiveSuppressedFingerprints(now: Date = new Date()): Promise<readonly string[]> {
        let records;
        try {
            records = await this.recordReader.readAll();
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return [];
            }

            throw error;
        }

        const latestByFingerprint = new Map<string, SanitizedFindingFeedback>();
        for (const record of records) {
            if (record.recordType !== "finding-feedback") {
                continue;
            }

            const latest = latestByFingerprint.get(record.fingerprint);
            if (isLater(record, latest)) {
                latestByFingerprint.set(record.fingerprint, record);
            }
        }

        return [...latestByFingerprint.values()]
            .filter((feedback) => suppressingStatuses.has(feedback.status))
            .filter((feedback) => feedback.expiresAt === undefined || new Date(feedback.expiresAt) > now)
            .map((feedback) => feedback.fingerprint);
    }
}
