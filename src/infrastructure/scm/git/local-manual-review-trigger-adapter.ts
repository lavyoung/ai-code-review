import {ReviewTriggerContextError,} from "../../../application/review/errors/review-trigger-error.js";
import type {
    ReviewTriggerAdapter,
    ReviewTriggerRequest,
    ReviewTriggerResolution,
} from "../../../application/review/ports/review-trigger-adapter.js";

/** 将 CLI 的本地手动参数转换为统一的三点比较调用。 */
export class LocalManualReviewTriggerAdapter implements ReviewTriggerAdapter {
    public readonly providerId = "local";
    public readonly event = "manual" as const;

    public validateConfiguration(): void {
        // 本地手动模式不依赖平台凭据。
    }

    public async resolve(request: ReviewTriggerRequest): Promise<ReviewTriggerResolution> {
        const target = request.target?.trim();
        if (target === undefined || target.length === 0) {
            throw new ReviewTriggerContextError(
                this.providerId,
                this.event,
                "A manual review target is required.",
            );
        }

        return {
            kind: "review",
            invocation: {
                providerId: this.providerId,
                event: this.event,
                repository: {id: "local", displayName: "local repository"},
                range: {baseRef: target, headRef: "HEAD", comparison: "three-dot"},
                reportTarget: target,
            },
        };
    }
}
