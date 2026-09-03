import {createReviewCommentId} from "../../../domain/review/model/review-comment.js";
import {
    ReviewTriggerConfigurationError,
    ReviewTriggerContextError,
} from "../../../application/review/errors/review-trigger-error.js";
import type {
    ReviewTriggerAdapter,
    ReviewTriggerRequest,
    ReviewTriggerResolution,
} from "../../../application/review/ports/review-trigger-adapter.js";
import {
    type CodeUpMergeRequestContext,
    CodeUpMergeRequestContextError,
    resolveCodeUpMergeRequestContext,
} from "./resolve-codeup-merge-request-context.js";
import {CodeUpReviewCommentAdapter} from "./codeup-review-comment-adapter.js";

export interface CodeUpMergeRequestReviewTriggerConfiguration {
    environment: NodeJS.ProcessEnv;
    commentEnabled: boolean;
    commentFailOnError: boolean;
    accessToken?: string;
}

type CodeUpMergeRequestContextResolver = (
    environment: NodeJS.ProcessEnv,
) => Promise<CodeUpMergeRequestContext>;

/** 将 CodeUp Flow MR 上下文转换为统一评审调用和可选摘要评论端口。 */
export class CodeUpMergeRequestReviewTriggerAdapter implements ReviewTriggerAdapter {
    public readonly providerId = "codeup";
    public readonly event = "merge-request" as const;

    public constructor(
        private readonly configuration: CodeUpMergeRequestReviewTriggerConfiguration,
        private readonly resolveContext: CodeUpMergeRequestContextResolver = resolveCodeUpMergeRequestContext,
    ) {
    }

    public validateConfiguration(): void {
        if (this.configuration.accessToken === undefined) {
            throw new ReviewTriggerConfigurationError(
                this.providerId,
                this.event,
                "CODEUP_TOKEN must be set for CodeUp MR lookup.",
            );
        }
    }

    public async resolve(_: ReviewTriggerRequest): Promise<ReviewTriggerResolution> {
        let context: CodeUpMergeRequestContext;
        try {
            context = await this.resolveContext(this.configuration.environment);
        } catch (error) {
            if (error instanceof CodeUpMergeRequestContextError) {
                throw new ReviewTriggerContextError(this.providerId, this.event, error.message);
            }
            throw error;
        }

        const summaryComment = this.configuration.commentEnabled
        && this.configuration.accessToken !== undefined
            ? {
                label: "CodeUp MR comment",
                enabled: true as const,
                reviewId: createReviewCommentId("codeup", context.repositoryId, context.changeRequestId),
                revision: context.headSha,
                port: new CodeUpReviewCommentAdapter({
                    apiBaseUrl: context.apiBaseUrl,
                    accessToken: this.configuration.accessToken,
                    repositoryId: context.repositoryId,
                    changeRequestId: context.changeRequestId,
                    patchSetBizId: context.patchSetBizId,
                    ...(context.organizationId === undefined ? {} : {organizationId: context.organizationId}),
                }),
                failOnError: this.configuration.commentFailOnError,
            }
            : {
                label: "CodeUp MR comment",
                enabled: false as const,
                failOnError: this.configuration.commentFailOnError,
            };

        return {
            kind: "review",
            invocation: {
                providerId: this.providerId,
                event: this.event,
                repository: {id: context.repositoryId, displayName: context.repositoryId},
                range: {baseRef: context.baseSha, headRef: context.headSha, comparison: "three-dot"},
                reportTarget: context.targetRef,
                summaryComment,
            },
        };
    }
}
