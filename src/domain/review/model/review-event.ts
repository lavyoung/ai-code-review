export const REVIEW_EVENT_TYPES = [
    "push",
    "merge-request",
    "pull-request",
    "manual",
    "schedule",
] as const;

export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

export const isReviewEventType = (
    value: string,
): value is ReviewEventType => REVIEW_EVENT_TYPES.includes(value as ReviewEventType);