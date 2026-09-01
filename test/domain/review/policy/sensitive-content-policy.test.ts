import { describe, expect, it } from "vitest";
import { redactSensitiveValues } from "../../../../src/domain/review/policy/sensitive-content-policy.js";

describe("redactSensitiveValues", () => {
    it("does not treat strict equality as a secret assignment", () => {
        expect(redactSensitiveValues("if (configuration.apiKey === undefined) {}")).toEqual({
            content: "if (configuration.apiKey === undefined) {}",
            redactedValueCount: 0,
        });
    });

    it("redacts a source string value without removing its closing quote", () => {
        expect(redactSensitiveValues('const message = "token: exposed-token";')).toEqual({
            content: 'const message = "token: [REDACTED]";',
            redactedValueCount: 1,
        });
    });

    it("preserves quotes and delimiters around assigned secret values", () => {
        expect(redactSensitiveValues('const token = "exposed-token";')).toEqual({
            content: 'const token = "[REDACTED]";',
            redactedValueCount: 1,
        });
    });
});
