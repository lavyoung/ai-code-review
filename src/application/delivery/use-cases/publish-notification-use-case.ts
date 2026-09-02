import type { NotificationMessage, NotifierPort } from "../ports/notifier-port.js";

/** 通知渠道的最终投递状态，可安全写入 CI 报告和摘要评论。 */
export interface NotificationDelivery {
    status: "delivered" | "failed";
    attempts: number;
}

/** 失败后额外重试两次，总尝试次数最多为三次。 */
const MAX_RETRIES = 2;

/**
 * 发布通知并记录脱敏的投递结果；失败原因不向上暴露，避免泄露 Webhook 或请求内容。
 */
export const publishNotificationUseCase = async (
    message: NotificationMessage,
    notifier: NotifierPort,
): Promise<NotificationDelivery> => {
    for (let attempts = 1; attempts <= MAX_RETRIES + 1; attempts += 1) {
        try {
            await notifier.publish(message);
            return { status: "delivered", attempts };
        } catch {
            if (attempts === MAX_RETRIES + 1) {
                return { status: "failed", attempts };
            }
        }
    }

    throw new Error("Notification retry loop did not complete.");
};
