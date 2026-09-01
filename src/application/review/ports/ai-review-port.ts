import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";

/**
 * 已支持或已预留的 AI 评审服务提供方。
 */
export type AiProvider = "deepseek" | "openai";

/**
 * 调用 AI 服务生成结构化评审分析的应用端口。
 */
export interface AiReviewPort {
    /**
     * 此端口实现所调用的 AI 服务提供方。
     */
    readonly provider: AiProvider;

    /**
     * 对已完成敏感内容过滤的变更执行评审。
     *
     * @param codeChange 可安全发送到模型的代码变更。
     * @returns 模型输出经校验后的结构化分析。
     */
    review(codeChange: CodeChange): Promise<ReviewAnalysis>;
}
