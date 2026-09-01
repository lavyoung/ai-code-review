import { describe, expect, it } from "vitest";
import {
    CLI_EXIT_CODES,
    getAiReviewFailureExitCode,
} from "../../../src/interfaces/cli/exit-code.js";

describe("CLI exit codes", () => {
    it("keeps non-zero public exit codes in the cross-platform safe range", () => {
        expect(Object.values(CLI_EXIT_CODES)
            .filter((exitCode) => exitCode !== 0)
            .every((exitCode) => exitCode >= 100 && exitCode <= 125))
            .toBe(true);
    });

    it("uses error-type-specific AI exit codes independent of provider", () => {
        expect(getAiReviewFailureExitCode("rate-limit"))
            .toBe(CLI_EXIT_CODES.AI_RATE_LIMITED);
        expect(getAiReviewFailureExitCode("timeout"))
            .toBe(CLI_EXIT_CODES.AI_TIMEOUT);
        expect(getAiReviewFailureExitCode("invalid-schema"))
            .toBe(CLI_EXIT_CODES.AI_INVALID_SCHEMA);
        expect(getAiReviewFailureExitCode("unknown"))
            .toBe(CLI_EXIT_CODES.AI_UNKNOWN_FAILED);
    });
});
