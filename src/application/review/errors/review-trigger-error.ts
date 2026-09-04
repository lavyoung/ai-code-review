/** 已注册 Trigger Adapter 的配置不完整或不合法。 */
export class ReviewTriggerConfigurationError extends Error {
    public constructor(
        public readonly providerId: string,
        public readonly event: string,
        message: string,
    ) {
        super(message);
        this.name = "ReviewTriggerConfigurationError";
    }
}

/** 平台事件负载无法安全转换为统一评审调用。 */
export class ReviewTriggerContextError extends Error {
    public constructor(
        public readonly providerId: string,
        public readonly event: string,
        message: string,
    ) {
        super(message);
        this.name = "ReviewTriggerContextError";
    }
}
