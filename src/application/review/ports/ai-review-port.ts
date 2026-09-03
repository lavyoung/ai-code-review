import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";
import type { ReviewAnalyzer } from "./review-analyzer-port.js";

/**
 * 调用 AI 服务生成结构化评审分析的应用端口。
 */
/**
 * @deprecated 新用例应依赖 `ReviewAnalyzer`。保留此端口只为现有 AI 适配器兼容。
 */
export interface AiReviewPort extends ReviewAnalyzer {
    /**
     * 此端口实现所调用的 AI 服务提供方。
     */
    readonly provider: string;

    /**
     * 对已完成敏感内容过滤的变更执行评审。
     *
     * @param codeChange 可安全发送到模型的代码变更。
     * @returns 模型输出经校验后的结构化分析。
     */
    review(codeChange: CodeChange): Promise<ReviewAnalysis>;
}
