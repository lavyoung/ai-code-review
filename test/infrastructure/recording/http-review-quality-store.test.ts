import {createHmac} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {HttpReviewQualityStore} from "../../../src/infrastructure/recording/http-review-quality-store.js";

const reviewRunRecord = {
    schemaVersion: "v1" as const,
    recordType: "review-run" as const,
    runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
    recordedAt: "2026-09-02T00:00:00.000Z",
    qualityGateFailed: false,
    highestSeverity: null,
    analyzerRuns: [],
    findings: [],
};

describe("HttpReviewQualityStore", () => {
    it("posts only the sanitized event with a versioned HMAC signature", async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {status: 202}));
        const timestamp = "2026-09-02T12:00:00.000Z";
        const store = new HttpReviewQualityStore({
            endpointUrl: "https://quality.example.test/events",
            signingSecret: "test-signing-secret",
        }, {
            fetchFn,
            now: () => new Date(timestamp),
        });

        await store.append(reviewRunRecord);

        const body = JSON.stringify(reviewRunRecord);
        const expectedSignature = createHmac("sha256", "test-signing-secret")
            .update(`${timestamp}.${body}`, "utf8")
            .digest("hex");
        expect(fetchFn).toHaveBeenCalledWith("https://quality.example.test/events", expect.objectContaining({
            method: "POST",
            body,
            headers: expect.objectContaining({
                "content-type": "application/json",
                "x-aicr-event-type": "review-run",
                "x-aicr-event-id": reviewRunRecord.runId,
                "x-aicr-timestamp": timestamp,
                "x-aicr-signature": `v1=${expectedSignature}`,
            }),
        }));
        expect(body).not.toContain(".env");
        expect(body).not.toContain("test-signing-secret");
    });

    it("rejects non-HTTPS endpoints and keeps remote failure details out of errors", async () => {
        expect(() => new HttpReviewQualityStore({
            endpointUrl: "http://quality.example.test/events",
            signingSecret: "test-signing-secret",
        })).toThrow("HTTPS");

        const store = new HttpReviewQualityStore({
            endpointUrl: "https://quality.example.test/events",
            signingSecret: "test-signing-secret",
        }, {
            fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response("token=leaked", {status: 500})),
        });

        await expect(store.append(reviewRunRecord))
            .rejects.toThrow("Review quality store response was unsuccessful.");
    });
});
