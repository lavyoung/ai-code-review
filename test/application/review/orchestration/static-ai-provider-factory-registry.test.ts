import {describe, expect, it} from "vitest";
import {
    StaticAiProviderFactoryRegistry
} from "../../../../src/application/review/orchestration/static-ai-provider-factory-registry.js";
import type {AiProviderFactory} from "../../../../src/application/review/ports/ai-provider-factory.js";

const factory: AiProviderFactory = {
    providerId: "example",
    validateConfiguration: () => undefined,
    create: () => {
        throw new Error("Not used by this registry test.");
    },
};

describe("StaticAiProviderFactoryRegistry", () => {
    it("resolves only explicitly registered AI providers", () => {
        const registry = new StaticAiProviderFactoryRegistry([factory]);

        expect(registry.resolve("example")).toBe(factory);
        expect(registry.resolve("unknown")).toBeUndefined();
        expect(registry.supported()).toEqual(["example"]);
    });

    it("rejects duplicate provider identifiers", () => {
        expect(() => new StaticAiProviderFactoryRegistry([factory, factory]))
            .toThrow("AI provider identifiers must be unique.");
    });
});
