import {ProviderConfigurationError} from "../../../application/review/errors/provider-configuration-error.js";
import type {
    ReviewDeliveryAdapter,
    SummaryCommentTarget,
} from "../../../application/delivery/ports/review-delivery-adapter.js";
import type {ReviewCommentPort} from "../../../application/delivery/ports/review-comment-port.js";
import {GitHubReviewCommentAdapter} from "../../scm/github/github-review-comment-adapter.js";

export interface GitHubReviewDeliveryConfiguration {
    accessToken?: string;
    apiBaseUrl?: string;
}

/** 根据 GitHub PR 公开目标创建幂等摘要评论端口。 */
export class GitHubReviewDeliveryAdapter implements ReviewDeliveryAdapter {
    public readonly providerId = "github";

    public constructor(private readonly configuration: GitHubReviewDeliveryConfiguration) {
    }

    public validateConfiguration(): void {
        if (this.configuration.accessToken === undefined) {
            throw new ProviderConfigurationError(
                "delivery",
                this.providerId,
                "GITHUB_TOKEN must be set for GitHub PR comments.",
            );
        }
    }

    public createSummaryCommentPort(target: SummaryCommentTarget): ReviewCommentPort {
        this.validateConfiguration();
        if (target.providerId !== this.providerId) {
            throw new ProviderConfigurationError("delivery", this.providerId, "GitHub comment target was invalid.");
        }
        const owner = target.attributes.owner;
        const repository = target.attributes.repository;
        const pullRequestNumber = target.attributes.pullRequestNumber;
        if (owner === undefined || repository === undefined || pullRequestNumber === undefined) {
            throw new ProviderConfigurationError("delivery", this.providerId, "GitHub comment target was incomplete.");
        }

        return new GitHubReviewCommentAdapter({
            owner,
            repository,
            pullRequestNumber,
            accessToken: this.configuration.accessToken!,
            ...(this.configuration.apiBaseUrl === undefined ? {} : {apiBaseUrl: this.configuration.apiBaseUrl}),
        });
    }
}
