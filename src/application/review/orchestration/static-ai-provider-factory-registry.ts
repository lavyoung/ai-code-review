import type {
    AiProviderFactory,
    AiProviderFactoryRegistry,
} from "../ports/ai-provider-factory.js";

/** 拒绝重复 Provider ID 的静态 AI 工厂注册表。 */
export class StaticAiProviderFactoryRegistry implements AiProviderFactoryRegistry {
    private readonly factories: ReadonlyMap<string, AiProviderFactory>;

    public constructor(factories: readonly AiProviderFactory[]) {
        const providerIds = factories.map((factory) => factory.providerId);
        if (new Set(providerIds).size !== providerIds.length) {
            throw new Error("AI provider identifiers must be unique.");
        }
        this.factories = new Map(factories.map((factory) => [factory.providerId, factory]));
    }

    public resolve(providerId: string): AiProviderFactory | undefined {
        return this.factories.get(providerId);
    }

    public supported(): readonly string[] {
        return [...this.factories.keys()];
    }
}
