import { describe, expect, it, vi } from "vitest";
import { publishNotificationUseCase } from "../src/application/publish-notification-use-case.js";

describe("publishNotificationUseCase", () => {
    it("retries twice before a successful delivery", async () => {
        const publish = vi.fn()
            .mockRejectedValueOnce(new Error("unavailable"))
            .mockRejectedValueOnce(new Error("unavailable"))
            .mockResolvedValueOnce(undefined);

        await expect(publishNotificationUseCase(
            { markdown: "safe report" },
            { publish },
        )).resolves.toEqual({ status: "delivered", attempts: 3 });
        expect(publish).toHaveBeenCalledTimes(3);
    });

    it("reports a failed delivery after the final retry", async () => {
        const publish = vi.fn().mockRejectedValue(new Error("unavailable"));

        await expect(publishNotificationUseCase(
            { markdown: "safe report" },
            { publish },
        )).resolves.toEqual({ status: "failed", attempts: 3 });
    });
});
