import type {ImpactPackage, StaticImpactRelation} from "../../../domain/impact/model/impact-package.js";

/** 将已锚定的静态关系压缩成供 AI 消费的影响包，不包含原始 diff 或仓库正文。 */
export const createImpactPackage = (
    relations: readonly StaticImpactRelation[],
    limitations: ImpactPackage["limitations"] = [],
): ImpactPackage => ({
    version: "v1",
    impacts: [...new Map(relations.map((relation) => [relation.changeAnchorId, relation])).values()]
        .map((relation) => ({
            id: `impact:${relation.changeAnchorId}`,
            changeAnchorId: relation.changeAnchorId,
            kind: "local-behavior" as const,
            relations: relations.filter((candidate) => candidate.changeAnchorId === relation.changeAnchorId),
            closure: {
                implementation: "unknown" as const,
                compatibility: "unknown" as const,
                validation: "not-assessable" as const,
            },
        })),
    limitations,
});
