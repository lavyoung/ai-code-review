import type { ReviewConfiguration } from "../../application/config/review-configuration.js";

/**
 * 构造可安全输出到 CLI 日志的配置视图。
 */
export const redactReviewConfiguration = (
    configuration: ReviewConfiguration,
) => {
    const { apiKey, ...ai } = configuration.ai;

    return {
        review: configuration.review,
        ai: {
            ...ai,
            ...(apiKey === undefined ? {} : { apiKey: "[REDACTED]" }),
        },
    };
};
