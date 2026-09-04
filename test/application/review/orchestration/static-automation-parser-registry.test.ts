import {describe, expect, it} from "vitest";
import {StaticAutomationParserRegistry} from "../../../../src/application/review/orchestration/static-automation-parser-registry.js";

describe("StaticAutomationParserRegistry", () => {
    it("resolves registered parsers and rejects duplicate platform identifiers", () => {
        const parser = {platformId: "example", parse: () => ({status: "not-applicable" as const})};
        const registry = new StaticAutomationParserRegistry([parser]);

        expect(registry.resolve("example")).toBe(parser);
        expect(registry.resolve("missing")).toBeUndefined();
        expect(() => new StaticAutomationParserRegistry([parser, parser])).toThrow("identifiers must be unique");
    });
});
