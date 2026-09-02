import type {CodeChange, RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {AnalyzerIdentity} from "../../../domain/review/model/analyzer-identity.js";
import type {AiReviewFailureType} from "../errors/review-execution-error.js";

/** 分析器的规范化身份；具体供应商名称不进入领域策略。 */
export type { AnalyzerIdentity } from "../../../domain/review/model/analyzer-identity.js";

/** 分析器可请求的安全输入等级。 */
export type AnalyzerInputAccess = "sanitized-model-input" | "trusted-raw-local";

/** 可安全持久化和输出的分析器失败原因码。 */
export type AnalyzerFailureReason = AiReviewFailureType | "not-registered" | "execution";

/** 分析器的调度和安全能力声明。 */
export interface AnalyzerCapabilities {
    inputAccess: AnalyzerInputAccess;
    supportsChangedOnly: boolean;
    supportsRepositoryScan: boolean;
}

/** 所有分析器都可接收的安全输入。 */
export interface SanitizedAnalysisRequest {
    codeChange: CodeChange;
    /** 调度器提供的截止信号；适配器应将其传递给可取消的底层调用。 */
    signal: AbortSignal;
}

/** 仅供已注册的本地可信分析器使用的附加原始输入。 */
export interface TrustedLocalAnalysisRequest extends SanitizedAnalysisRequest {
    rawCodeChange: RawCodeChange;
}

/** 调度器按能力声明创建的分析请求。 */
export type AnalysisRequest = SanitizedAnalysisRequest | TrustedLocalAnalysisRequest;

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

/** 单个分析器在本次评审中的执行计划。 */
export interface AnalyzerExecutionPlan {
    analyzerId: string;
    required: boolean;
    timeoutMs: number;
    /** 瞬时失败后允许的额外尝试次数；未指定时不重试。 */
    retryCount?: number;
    failureMode: "fail" | "degrade";
}

/** 一次评审运行的全局调度上限。 */
export interface ReviewRunBudget {
    totalTimeoutMs: number;
    maxConcurrency: number;
    maxAiRequestCount: number;
    maxModelInputChars: number;
}

/** 分析器的安全运行摘要，不包含输入或供应商响应正文。 */
export interface AnalyzerRun {
    analyzer: AnalyzerIdentity;
    status: "completed" | "degraded" | "failed";
    /** 本分析器实际执行的次数；未注册而跳过的计划为 0。 */
    attempts: number;
    /** 仅包含稳定、脱敏的失败类别；绝不保存适配器错误正文。 */
    failureReason?: AnalyzerFailureReason;
    durationMs: number;
}

/** 注册经过审核的分析器；配置只能选择已注册 ID。 */
export interface ReviewAnalyzerRegistry {
    resolve(analyzerId: string): ReviewAnalyzer | undefined;
}
