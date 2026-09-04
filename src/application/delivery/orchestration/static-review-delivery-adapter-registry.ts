import type {
    ReviewDeliveryAdapter,
    ReviewDeliveryAdapterRegistry,
} from "../ports/review-delivery-adapter.js";

/** 拒绝重复 Provider ID 的静态评论交付适配器注册表。 */
export class StaticReviewDeliveryAdapterRegistry implements ReviewDeliveryAdapterRegistry {
    private readonly adapters: ReadonlyMap<string, ReviewDeliveryAdapter>;

    public constructor(adapters: readonly ReviewDeliveryAdapter[]) {
        const providerIds = adapters.map((adapter) => adapter.providerId);
        if (new Set(providerIds).size !== providerIds.length) {
            throw new Error("Review delivery provider identifiers must be unique.");
        }
        this.adapters = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
    }

    public resolve(providerId: string): ReviewDeliveryAdapter | undefined {
        return this.adapters.get(providerId);
    }

    public supported(): readonly string[] {
        return [...this.adapters.keys()];
    }
}
