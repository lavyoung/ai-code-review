import { describe, expect, it, vi } from "vitest";
import {
    createSanitizedFindingFeedback,
    recordFindingFeedbackUseCase,
} from "../../../../src/application/review/recording/record-finding-feedback-use-case.js";

describe("finding feedback recording", () => {
    it("creates an event containing only safe feedback fields", () => {
        const feedback = createSanitizedFindingFeedback({
            fingerprint: "0123456789abcdef01234567",
            status: "false-positive",
            runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
        }, "2026-09-02T00:00:00.000Z", "40e4c6ec-8be2-4de2-9d5e-54cda88a3cf0");

        expect(feedback).toEqual({
            schemaVersion: "v1",
            recordType: "finding-feedback",
            feedbackId: "40e4c6ec-8be2-4de2-9d5e-54cda88a3cf0",
            fingerprint: "0123456789abcdef01234567",
            status: "false-positive",
            recordedAt: "2026-09-02T00:00:00.000Z",
            runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
        });
        expect(JSON.stringify(feedback)).not.toContain(".env");
        expect(JSON.stringify(feedback)).not.toContain("token=");
    });

    it("returns a safe delivery status when persistence succeeds or fails", async () => {
        const feedback = createSanitizedFindingFeedback({
            fingerprint: "0123456789abcdef01234567",
            status: "accepted",
        });

        await expect(recordFindingFeedbackUseCase(feedback, {
            appendFeedback: vi.fn().mockResolvedValue(undefined),
        })).resolves.toBe("delivered");
        await expect(recordFindingFeedbackUseCase(feedback, {
            appendFeedback: vi.fn().mockRejectedValue(new Error("path=C:/secret")),
        })).resolves.toBe("failed");
    });
});
