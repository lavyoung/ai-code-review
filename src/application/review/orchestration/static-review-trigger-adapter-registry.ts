import type {ReviewTriggerAdapter, ReviewTriggerAdapterRegistry,} from "../ports/review-trigger-adapter.js";
import type {ReviewEventType} from "../../../domain/review/model/review-event.js";

const registryKey = (providerId: string, event: ReviewEventType): string => `${providerId}:${event}`;

/** 将编译期装配的触发适配器按 Provider/Event 唯一注册。 */
export class StaticReviewTriggerAdapterRegistry implements ReviewTriggerAdapterRegistry {
    private readonly adapters: Map<string, ReviewTriggerAdapter>;

    public constructor(adapters: readonly ReviewTriggerAdapter[]) {
        this.adapters = new Map();
        for (const adapter of adapters) {
            const key = registryKey(adapter.providerId, adapter.event);
            if (this.adapters.has(key)) {
                throw new Error(`Duplicate review trigger adapter: ${key}.`);
            }
            this.adapters.set(key, adapter);
        }
    }

    public resolve(providerId: string, event: ReviewEventType): ReviewTriggerAdapter | undefined {
        return this.adapters.get(registryKey(providerId, event));
    }

    public supported(): readonly { providerId: string; event: ReviewEventType }[] {
        return [...this.adapters.values()].map((adapter) => ({
            providerId: adapter.providerId,
            event: adapter.event,
        }));
    }
}
