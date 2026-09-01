import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";

/** 分析器的规范化身份；具体供应商名称不进入领域策略。 */
export interface AnalyzerIdentity {
    kind: "ai" | "sast" | "linter" | "typecheck" | "test" | "secret-scan";
    id: string;
    version?: string;
}

/** 分析器可请求的安全输入等级。 */
export type AnalyzerInputAccess = "sanitized-model-input" | "trusted-raw-local";

/** 分析器的调度和安全能力声明。 */
export interface AnalyzerCapabilities {
    inputAccess: AnalyzerInputAccess;
    supportsChangedOnly: boolean;
    supportsRepositoryScan: boolean;
}

/** 通用分析器的安全输入。当前阶段只暴露已脱敏的变更集。 */
export interface AnalysisRequest {
    codeChange: CodeChange;
}

/**
 * 生成结构化评审候选项的通用应用端口。
 *
 * AI、SAST、类型检查和测试适配器都必须转换为该端口；策略层不依赖其供应商。
 */
export interface ReviewAnalyzer {
    readonly identity: AnalyzerIdentity;
    readonly capabilities: AnalyzerCapabilities;

    analyze(request: AnalysisRequest): Promise<ReviewAnalysis>;
}
