import {describe, expect, it} from "vitest";
import {
    StaticReviewTriggerAdapterRegistry
} from "../../../../src/application/review/orchestration/static-review-trigger-adapter-registry.js";
import type {ReviewTriggerAdapter} from "../../../../src/application/review/ports/review-trigger-adapter.js";

const manualAdapter: ReviewTriggerAdapter = {
    providerId: "local",
    event: "manual",
    validateConfiguration: () => undefined,
    resolve: async () => ({kind: "skip", skip: {reason: "initial-push"}}),
};

describe("StaticReviewTriggerAdapterRegistry", () => {
    it("resolves only the explicitly registered provider and event", () => {
        const registry = new StaticReviewTriggerAdapterRegistry([manualAdapter]);

        expect(registry.resolve("local", "manual")).toBe(manualAdapter);
        expect(registry.resolve("github", "manual")).toBeUndefined();
        expect(registry.supported()).toEqual([{providerId: "local", event: "manual"}]);
    });

    it("rejects duplicate provider and event registrations", () => {
        expect(() => new StaticReviewTriggerAdapterRegistry([manualAdapter, manualAdapter]))
            .toThrow("Duplicate review trigger adapter: local:manual.");
    });
});
