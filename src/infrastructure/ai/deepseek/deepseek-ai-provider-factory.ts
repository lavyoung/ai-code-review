import {ProviderConfigurationError} from "../../../application/review/errors/provider-configuration-error.js";
import type {
    AiProviderFactory,
    AiProviderRuntimeConfiguration,
} from "../../../application/review/ports/ai-provider-factory.js";
import type {ReviewAnalyzer} from "../../../application/review/ports/review-analyzer-port.js";
import {DeepSeekReviewAdapter} from "./deepseek-review-adapter.js";

/** 将通用 AI Provider 配置转换为 DeepSeek 结构化评审适配器。 */
export class DeepSeekAiProviderFactory implements AiProviderFactory {
    public readonly providerId = "deepseek";

    public validateConfiguration(configuration: AiProviderRuntimeConfiguration): void {
        if (configuration.apiKey === undefined) {
            throw new ProviderConfigurationError(
                "ai",
                this.providerId,
                "DEEPSEEK_API_KEY must be set when the DeepSeek analyzer is enabled.",
            );
        }
    }

    public create(configuration: AiProviderRuntimeConfiguration): ReviewAnalyzer {
        this.validateConfiguration(configuration);
        return new DeepSeekReviewAdapter(configuration);
    }
}
