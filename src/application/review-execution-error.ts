/**
 * 手动评审中无法获取 Git 变更时抛出的应用错误。
 */
export class DiffResolutionError extends Error {
    public constructor(cause: unknown) {
        super("Unable to resolve committed Git changes.", { cause });
        this.name = "DiffResolutionError";
    }
}

/**
 * AI 调用与结构化结果解析的失败类型。
 */
export type AiReviewFailureType =
    | "request"
    | "authentication"
    | "rate-limit"
    | "timeout"
    | "incomplete-response"
    | "invalid-json"
    | "invalid-schema"
    | "content-filtered"
    | "context-limit"
    | "unknown";

/**
 * 基础设施适配器向应用层报告的已分类 AI 失败。
 */
export class AiReviewFailure extends Error {
    public constructor(
        public readonly failureType: AiReviewFailureType,
        message: string,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = "AiReviewFailure";
    }
}

/**
 * 手动评审中 AI 调用或结果解析失败时抛出的应用错误。
 */
export class AiReviewExecutionError extends Error {
    public constructor(
        public readonly failureType: AiReviewFailureType,
        cause: unknown,
    ) {
        super("Unable to complete AI review.", { cause });
        this.name = "AiReviewExecutionError";
    }
}
