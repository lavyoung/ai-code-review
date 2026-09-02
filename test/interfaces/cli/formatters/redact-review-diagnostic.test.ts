import {describe, expect, it} from "vitest";
import {redactReviewDiagnostic} from "../../../../src/interfaces/cli/formatters/redact-review-diagnostic.js";

describe("redactReviewDiagnostic", () => {
    it("removes sensitive values and paths before a diagnostic reaches CI logs", () => {
        const diagnostic = redactReviewDiagnostic(
            "request for .env.production failed: token=exposed-value",
        );

        expect(diagnostic).toBe("request for [REDACTED_FILE] failed: token=[REDACTED]");
        expect(diagnostic).not.toContain("exposed-value");
        expect(diagnostic).not.toContain(".env.production");
    });
});
