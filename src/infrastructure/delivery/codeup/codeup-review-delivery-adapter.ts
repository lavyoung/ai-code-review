import {ProviderConfigurationError} from "../../../application/review/errors/provider-configuration-error.js";
import type {
    ReviewDeliveryAdapter,
    SummaryCommentTarget,
} from "../../../application/delivery/ports/review-delivery-adapter.js";
import type {ReviewCommentPort} from "../../../application/delivery/ports/review-comment-port.js";
import {CodeUpReviewCommentAdapter} from "../../scm/codeup/codeup-review-comment-adapter.js";

export interface CodeUpReviewDeliveryConfiguration {
    accessToken?: string;
}

/** 根据 CodeUp MR 公开目标创建幂等摘要评论端口。 */
export class CodeUpReviewDeliveryAdapter implements ReviewDeliveryAdapter {
    public readonly providerId = "codeup";

    public constructor(private readonly configuration: CodeUpReviewDeliveryConfiguration) {
    }

    public validateConfiguration(): void {
        if (this.configuration.accessToken === undefined) {
            throw new ProviderConfigurationError(
                "delivery",
                this.providerId,
                "CODEUP_TOKEN must be set for CodeUp MR comments.",
            );
        }
    }

    public createSummaryCommentPort(target: SummaryCommentTarget): ReviewCommentPort {
        this.validateConfiguration();
        if (target.providerId !== this.providerId) {
            throw new ProviderConfigurationError("delivery", this.providerId, "CodeUp comment target was invalid.");
        }
        const apiBaseUrl = target.attributes.apiBaseUrl;
        const repositoryId = target.attributes.repositoryId;
        const changeRequestId = target.attributes.changeRequestId;
        const patchSetBizId = target.attributes.patchSetBizId;
        if (apiBaseUrl === undefined || repositoryId === undefined
            || changeRequestId === undefined || patchSetBizId === undefined) {
            throw new ProviderConfigurationError("delivery", this.providerId, "CodeUp comment target was incomplete.");
        }

        const organizationId = target.attributes.organizationId;
        return new CodeUpReviewCommentAdapter({
            apiBaseUrl,
            accessToken: this.configuration.accessToken!,
            repositoryId,
            changeRequestId,
            patchSetBizId,
            ...(organizationId === undefined ? {} : {organizationId}),
        });
    }
}
