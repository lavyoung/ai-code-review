/** 已选择的 AI 或交付 Provider 未注册或缺少安全运行所需配置。 */
export class ProviderConfigurationError extends Error {
    public constructor(
        public readonly providerKind: "ai" | "delivery",
        public readonly providerId: string,
        message: string,
    ) {
        super(message);
        this.name = "ProviderConfigurationError";
    }
}
