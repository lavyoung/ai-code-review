import {createHmac} from "node:crypto";
import type {
    ReviewQualityStore,
    SanitizedFindingFeedback,
    SanitizedReviewRunRecord,
} from "../../application/review/ports/review-run-record-port.js";

/** 组织质量存储的签名 HTTPS 投递配置；签名密钥只能由运行时 Secret 注入。 */
export interface HttpReviewQualityStoreConfiguration {
    endpointUrl: string;
    signingSecret: string;
    timeoutMs?: number;
}

export interface HttpReviewQualityStoreRuntime {
    fetchFn?: typeof fetch;
    now?: () => Date;
}

/**
 * 向组织受控质量存储投递一个版本化脱敏事件。
 *
 * 请求正文为 `SanitizedQualityRecord` JSON；接收方使用
 * `HMAC-SHA256(timestamp + "." + body)` 校验 `X-AICR-Signature`，并按事件 ID 去重。
 */
export class HttpReviewQualityStore implements ReviewQualityStore {
    private readonly endpointUrl: string;
    private readonly fetchFn: typeof fetch;
    private readonly now: () => Date;
    private readonly timeoutMs: number;

    public constructor(
        private readonly configuration: HttpReviewQualityStoreConfiguration,
        runtime: HttpReviewQualityStoreRuntime = {},
    ) {
        const endpoint = new URL(configuration.endpointUrl);
        if (endpoint.protocol !== "https:") {
            throw new Error("Review quality store endpoint must use HTTPS.");
        }

        this.endpointUrl = endpoint.toString();
        this.fetchFn = runtime.fetchFn ?? fetch;
        this.now = runtime.now ?? (() => new Date());
        this.timeoutMs = configuration.timeoutMs ?? 10_000;
    }

    public async append(record: SanitizedReviewRunRecord): Promise<void> {
        await this.publish(record.recordType, record.runId, record);
    }

    public async appendFeedback(feedback: SanitizedFindingFeedback): Promise<void> {
        await this.publish(feedback.recordType, feedback.feedbackId, feedback);
    }

    private async publish(
        eventType: SanitizedReviewRunRecord["recordType"] | SanitizedFindingFeedback["recordType"],
        eventId: string,
        record: SanitizedReviewRunRecord | SanitizedFindingFeedback,
    ): Promise<void> {
        const body = JSON.stringify(record);
        const timestamp = this.now().toISOString();
        const signature = createHmac("sha256", this.configuration.signingSecret)
            .update(`${timestamp}.${body}`, "utf8")
            .digest("hex");

        let response: Response;
        try {
            response = await this.fetchFn(this.endpointUrl, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-aicr-event-type": eventType,
                    "x-aicr-event-id": eventId,
                    "x-aicr-timestamp": timestamp,
                    "x-aicr-signature": `v1=${signature}`,
                },
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch {
            throw new Error("Review quality store request failed.");
        }

        if (!response.ok) {
            throw new Error("Review quality store response was unsuccessful.");
        }
    }
}
