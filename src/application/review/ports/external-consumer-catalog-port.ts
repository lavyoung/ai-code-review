import type {
    ExternalConsumerContextSummary,
    StaticImpactRelation,
} from "../../../domain/impact/model/impact-package.js";

/** 经审核的外部消费者目录；只映射已知消费者，不判断兼容性。 */
export interface ExternalConsumerCatalogPort {
    resolve(
        contractRelations: readonly StaticImpactRelation[],
        signal: AbortSignal,
    ): Promise<ExternalConsumerContextSummary>;
}
