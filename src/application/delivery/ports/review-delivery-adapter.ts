import type {ReviewCommentPort} from "./review-comment-port.js";

/** Trigger Adapter 提供的、可安全传递到交付适配器的摘要评论目标。 */
export interface SummaryCommentTarget {
    providerId: string;
    label: string;
    reviewId: string;
    revision: string;
    /** 仅包含平台公开标识；不得包含 Token、事件文件路径或原始负载。 */
    attributes: Readonly<Record<string, string>>;
}

/** 创建某一平台摘要评论端口的基础设施适配器。 */
export interface ReviewDeliveryAdapter {
    readonly providerId: string;

    validateConfiguration(): void;

    createSummaryCommentPort(target: SummaryCommentTarget): ReviewCommentPort;
}

/** 编译期装配的评论交付适配器查询注册表。 */
export interface ReviewDeliveryAdapterRegistry {
    resolve(providerId: string): ReviewDeliveryAdapter | undefined;

    supported(): readonly string[];
}
