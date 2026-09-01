import type { CodeChange } from "../../domain/review/code-change.js";
import type { ReviewAnalysis } from "../../domain/review/review-finding.js";

/**
 * 调用 AI 服务生成结构化评审分析的应用端口。
 */
export interface AiReviewPort {
    /**
     * 对已完成敏感内容过滤的变更执行评审。
     *
     * @param codeChange 可安全发送到模型的代码变更。
     * @returns 模型输出经校验后的结构化分析。
     */
    review(codeChange: CodeChange): Promise<ReviewAnalysis>;
}
