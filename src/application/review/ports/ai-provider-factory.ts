import type {ReviewAnalyzer} from "./review-analyzer-port.js";

/** 某个已注册 AI Provider 的运行时配置；密钥只由环境变量或 CI Secret 注入。 */
export interface AiProviderRuntimeConfiguration {
    provider: string;
    model: string;
    outputLanguage: string;
    timeoutMs: number;
    apiKey?: string;
}

/** 创建一个结构化 AI 分析器的受审核 Provider 工厂。 */
export interface AiProviderFactory {
    readonly providerId: string;

    validateConfiguration(configuration: AiProviderRuntimeConfiguration): void;

    create(configuration: AiProviderRuntimeConfiguration): ReviewAnalyzer;
}

/** 编译期装配的 AI Provider 查询注册表。 */
export interface AiProviderFactoryRegistry {
    resolve(providerId: string): AiProviderFactory | undefined;

    supported(): readonly string[];
}
