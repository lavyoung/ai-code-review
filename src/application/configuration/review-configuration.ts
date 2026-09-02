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
        provider: "deepseek";
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
        sarif: {
            enabled: boolean;
            reportPath?: string;
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
    };
}
