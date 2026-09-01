import type { NotificationMessage, NotifierPort } from "../../application/ports/notifier-port.js";

interface WeComWebhookResponse {
    errcode?: number;
}

/** 企业微信机器人 Webhook 的基础设施适配器。 */
export class WeComNotifier implements NotifierPort {
    public constructor(
        private readonly webhookUrl: string,
        private readonly send: typeof fetch = fetch,
    ) {}

    /**
     * 以企业微信 Markdown 消息格式投递已脱敏评审报告。
     *
     * @throws 当 HTTP 请求或企业微信业务响应失败时抛出不含敏感信息的错误。
     */
    public async publish(message: NotificationMessage): Promise<void> {
        const response = await this.send(this.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                msgtype: "markdown",
                markdown: { content: message.markdown },
            }),
        });

        if (!response.ok) {
            throw new Error("WeCom notification request failed.");
        }

        let payload: WeComWebhookResponse;
        try {
            payload = await response.json() as WeComWebhookResponse;
        } catch {
            throw new Error("WeCom notification response was invalid.");
        }

        if (payload.errcode !== 0) {
            throw new Error("WeCom notification was rejected.");
        }
    }
}
