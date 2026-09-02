import type { AiReviewFailureType } from "../../application/review/errors/review-execution-error.js";

/**
 * CLI 对 CI 与调用方公开的稳定进程退出码。
 *
 * 非零值保持在 125 以内，避免与 Unix 信号退出语义冲突。
 */
export const CLI_EXIT_CODES = {
    SUCCESS: 0,
    QUALITY_GATE_FAILED: 100,
    INVALID_ARGUMENT: 101,
    INVALID_CONFIGURATION: 102,
    GIT_DIFF_FAILED: 103,
    REQUIRED_ANALYZER_FAILED: 104,
    REQUIRED_VERIFIER_FAILED: 105,
    REVIEW_CONTRACT_FAILED: 106,
    REVIEW_RECORDING_FAILED: 107,
    AI_REQUEST_FAILED: 110,
    AI_AUTHENTICATION_FAILED: 111,
    AI_RATE_LIMITED: 112,
    AI_TIMEOUT: 113,
    AI_INCOMPLETE_RESPONSE: 114,
    AI_INVALID_JSON: 115,
    AI_INVALID_SCHEMA: 116,
    AI_CONTENT_FILTERED: 117,
    AI_CONTEXT_LIMIT: 118,
    AI_UNKNOWN_FAILED: 119,
    COMMENT_PUBLICATION_FAILED: 120,
    NOTIFICATION_PUBLICATION_FAILED: 121,
} as const;

/**
 * 将 AI 失败类型映射为稳定退出码，且不依赖具体提供方。
 */
export const getAiReviewFailureExitCode = (
    failureType: AiReviewFailureType,
): number => {
    switch (failureType) {
        case "request":
            return CLI_EXIT_CODES.AI_REQUEST_FAILED;
        case "authentication":
            return CLI_EXIT_CODES.AI_AUTHENTICATION_FAILED;
        case "rate-limit":
            return CLI_EXIT_CODES.AI_RATE_LIMITED;
        case "timeout":
            return CLI_EXIT_CODES.AI_TIMEOUT;
        case "incomplete-response":
            return CLI_EXIT_CODES.AI_INCOMPLETE_RESPONSE;
        case "invalid-json":
            return CLI_EXIT_CODES.AI_INVALID_JSON;
        case "invalid-schema":
            return CLI_EXIT_CODES.AI_INVALID_SCHEMA;
        case "content-filtered":
            return CLI_EXIT_CODES.AI_CONTENT_FILTERED;
        case "context-limit":
            return CLI_EXIT_CODES.AI_CONTEXT_LIMIT;
        case "unknown":
            return CLI_EXIT_CODES.AI_UNKNOWN_FAILED;
    }
};
