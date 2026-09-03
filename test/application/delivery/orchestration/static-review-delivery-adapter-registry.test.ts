import {describe, expect, it} from "vitest";
import {
    StaticReviewDeliveryAdapterRegistry
} from "../../../../src/application/delivery/orchestration/static-review-delivery-adapter-registry.js";
import type {ReviewDeliveryAdapter} from "../../../../src/application/delivery/ports/review-delivery-adapter.js";

const adapter: ReviewDeliveryAdapter = {
    providerId: "example",
    validateConfiguration: () => undefined,
    createSummaryCommentPort: () => {
        throw new Error("Not used by this registry test.");
    },
};

describe("StaticReviewDeliveryAdapterRegistry", () => {
    it("resolves only explicitly registered delivery providers", () => {
        const registry = new StaticReviewDeliveryAdapterRegistry([adapter]);

        expect(registry.resolve("example")).toBe(adapter);
        expect(registry.resolve("unknown")).toBeUndefined();
        expect(registry.supported()).toEqual(["example"]);
    });

    it("rejects duplicate provider identifiers", () => {
        expect(() => new StaticReviewDeliveryAdapterRegistry([adapter, adapter]))
            .toThrow("Review delivery provider identifiers must be unique.");
    });
});
