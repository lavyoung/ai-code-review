import type {
    ReviewQualityStore,
    SanitizedFindingFeedback,
    SanitizedReviewRunRecord,
} from "../../application/review/ports/review-run-record-port.js";

/** 同时写入本地审计文件和组织受控质量存储。 */
export class CompositeReviewQualityStore implements ReviewQualityStore {
    public constructor(private readonly stores: readonly ReviewQualityStore[]) {
        if (stores.length === 0) {
            throw new Error("At least one review quality store is required.");
        }
    }

    public async append(record: SanitizedReviewRunRecord): Promise<void> {
        await Promise.all(this.stores.map(async (store) => store.append(record)));
    }

    public async appendFeedback(feedback: SanitizedFindingFeedback): Promise<void> {
        await Promise.all(this.stores.map(async (store) => store.appendFeedback(feedback)));
    }
}
