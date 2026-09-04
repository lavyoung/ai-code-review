/**
 * 读取受控环境对指定消费者快照和契约组合产生的兼容性证明。
 *
 * 返回值仍需由应用层与当前已审核消费者目录交叉校验，不能直接成为兼容性结论。
 */
export interface ConsumerCompatibilityEvidencePort {
    readValidatedConsumers(signal: AbortSignal): Promise<readonly ConsumerCompatibilityClaim[]>;
}

/** 签名证明中可供目录匹配的最小声明，禁止携带消费者代码或契约正文。 */
export interface ConsumerCompatibilityClaim {
    consumerId: string;
    consumerSourceRevision: string;
    contractPath: string;
}
