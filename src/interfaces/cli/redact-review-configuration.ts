import type { ReviewConfiguration } from "../../domain/review/review-configuration.js";

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
