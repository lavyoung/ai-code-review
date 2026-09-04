import type {SummaryCommentTarget} from "../../delivery/ports/review-delivery-adapter.js";
import type {ReviewEventType} from "../../../domain/review/model/review-event.js";
import type {DiffRange} from "./diff-provider.js";

/** 平台事件解析后可供统一评审用例消费的提交范围与交付信息。 */
export interface ReviewInvocation {
    providerId: string;
    event: ReviewEventType;
    repository: {
        id: string;
        displayName: string;
    };
    range: DiffRange;
    reportTarget: string;
    summaryComment?: ReviewSummaryComment;
}

/** 平台提供的摘要评论投递意图；评审编排不依赖具体平台评论实现。 */
export type ReviewSummaryComment =
    | {
    label: string;
    enabled: false;
    failOnError: boolean;
}
    | {
    label: string;
    enabled: true;
    target: SummaryCommentTarget;
    failOnError: boolean;
};

/** 合法但无需执行评审的平台事件，例如首次 Push。 */
export interface ReviewSkip {
    reason: "initial-push" | "branch-deleted" | "tag-push";
}

export type ReviewTriggerResolution =
    | { kind: "review"; invocation: ReviewInvocation }
    | { kind: "skip"; skip: ReviewSkip };

/** CLI 解析得到、交给触发适配器的通用输入。 */
export interface ReviewTriggerRequest {
    target?: string;
}

/**
 * 将某个平台和事件转换为统一评审调用。
 *
 * 平台事件文件、环境变量、API 与凭据只能由基础设施实现读取；应用层仅消费
 * 已验证的提交范围和可选投递端口。
 */
export interface ReviewTriggerAdapter {
    readonly providerId: string;
    readonly event: ReviewEventType;

    validateConfiguration(): void;

    resolve(request: ReviewTriggerRequest): Promise<ReviewTriggerResolution>;
}

/** 已审核 Trigger Adapter 的查询注册表。 */
export interface ReviewTriggerAdapterRegistry {
    resolve(providerId: string, event: ReviewEventType): ReviewTriggerAdapter | undefined;

    supported(): readonly { providerId: string; event: ReviewEventType }[];
}
