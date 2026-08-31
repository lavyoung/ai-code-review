import { describe, expect, it } from "vitest";
import {
    REVIEW_EVENT_TYPES,
    isReviewEventType,
} from "../src/domain/review/review-event.js";

describe("isReviewEventType", () => {
    it("accepts every supported review event", () => {
        for (const eventType of REVIEW_EVENT_TYPES) {
            expect(isReviewEventType(eventType)).toBe(true);
        }
    });

    it("rejects unsupported review events", () => {
        expect(isReviewEventType("merge_request")).toBe(false);
        expect(isReviewEventType("unknown")).toBe(false);
    });
});