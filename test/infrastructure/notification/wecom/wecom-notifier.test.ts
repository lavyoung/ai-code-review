import { describe, expect, it, vi } from "vitest";
import { WeComNotifier } from "../../../../src/infrastructure/notification/wecom/wecom-notifier.js";

const WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test";

describe("WeComNotifier", () => {
    it("posts the report as a Markdown robot message", async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ errcode: 0, errmsg: "ok" }),
            { status: 200 },
        ));
        const notifier = new WeComNotifier(WEBHOOK_URL, send);

        await expect(notifier.publish({ markdown: "## AI Code Review" })).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledWith(WEBHOOK_URL, expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                msgtype: "markdown",
                markdown: { content: "## AI Code Review" },
            }),
        }));
    });

    it("rejects a non-success WeCom business response", async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ errcode: 40013 }),
            { status: 200 },
        ));

        await expect(new WeComNotifier(WEBHOOK_URL, send).publish({ markdown: "report" }))
            .rejects.toThrow("WeCom notification was rejected.");
    });
});
