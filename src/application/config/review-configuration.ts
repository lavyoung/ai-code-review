import type { Severity } from "../../domain/review/severity.js";

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
        timeoutMs: number;
        apiKey?: string;
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
