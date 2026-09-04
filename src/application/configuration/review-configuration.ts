import type {Severity} from "../../domain/review/model/severity.js";

/**
 * 评审用例的已解析配置。
 *
 * API Key 仅可由环境变量或 CI Secret 注入，调用方不得将其写入日志或评论。
 */
export interface ReviewConfiguration {
    review: {
        severityThreshold: Severity;
        failOn: Severity[];
    };
    ai: {
        /** 已注册的 AI Provider ID；未知值必须由注册表拒绝。 */
        provider: string;
        /** AI 语义分析器是否启用；旧的 deepseek 分析器配置仍作为兼容入口保留。 */
        enabled: boolean;
        model: string;
        /** AI 评审文本使用的自然语言；JSON 字段名与严重级别不受影响。 */
        outputLanguage: string;
        timeoutMs: number;
        apiKey?: string;
    };
    execution: {
        totalTimeoutMs: number;
        maxAnalyzerConcurrency: number;
        maxAiRequestCount: number;
        /** 单个远程 AI 分析器可接收的安全 JSON diff 字符上限。 */
        maxModelInputChars: number;
    };
    analyzers: {
        deepseek: {
            enabled: boolean;
        };
        typescript: {
            enabled: boolean;
            timeoutMs: number;
        };
        typescriptAst: {
            enabled: boolean;
        };
        javaAst: {
            /** 只解析已提交 Java diff 中可由语法直接证明的模式，不执行构建工具。 */
            enabled: boolean;
        };
        sandboxTests: {
            enabled: boolean;
            /** 受控沙箱产生的签名结果文件；禁止输出路径或原始内容。 */
            reportPath?: string;
            /** 仅由环境变量或 CI Secret 注入，禁止写入配置文件与日志。 */
            signingSecret?: string;
        };
        sarif: {
            enabled: boolean;
            reportPath?: string;
            /** 可选签名证明文件；只有其验证通过时，SARIF 发现才可参与质量门禁。 */
            attestationPath?: string;
            /** 仅由环境变量或 CI 变量注入，禁止写入配置文件与日志。 */
            verificationPublicKey?: string;
        };
        secretScan: {
            enabled: boolean;
        };
    };
    recording: {
        /** 可选的本地 JSONL 运行记录路径；禁止在日志中输出此路径。 */
        localPath?: string;
        /** 组织受控质量存储；只接收经 HMAC 签名的脱敏事件。 */
        qualityStore: {
            enabled: boolean;
            endpointUrl?: string;
            /** 仅由环境变量或 CI Secret 注入，禁止写入配置文件与日志。 */
            signingSecret?: string;
        };
    };
    notifications: {
        wecom: {
            enabled: boolean;
            failOnError: boolean;
            /** 仅由环境变量或 CI Secret 注入，禁止写入配置文件与日志。 */
            webhookUrl?: string;
        };
    };
    comments: {
        github: {
            enabled: boolean;
            failOnError: boolean;
            /** 仅由环境变量或 CI Secret 注入，禁止写入配置文件与日志。 */
            accessToken?: string;
        };
        codeup: {
            enabled: boolean;
            failOnError: boolean;
            /** 仅由环境变量或 CI Secret 注入，禁止写入配置文件与日志。 */
            accessToken?: string;
        };
        /** 规范化的 Provider 评论配置；保留 github/codeup 字段以兼容现有调用方。 */
        providers: Readonly<Record<string, {
            enabled: boolean;
            failOnError: boolean;
        }>>;
    };
}
