import type {
    ImpactPackage,
    StaticImpactRelation,
    TestInventorySummary,
} from "../../../domain/impact/model/impact-package.js";
import {createTestObligations} from "../../../domain/impact/policy/create-test-obligations.js";

/** 将已锚定的静态关系压缩成供 AI 消费的影响包，不包含原始 diff 或仓库正文。 */
export const createImpactPackage = (
    relations: readonly StaticImpactRelation[],
    limitations: ImpactPackage["limitations"] = [],
    testInventory: TestInventorySummary = {status: "unavailable", frameworks: [], assetCount: 0},
): ImpactPackage => {
    const impacts = [...new Map(relations.map((relation) => [relation.changeAnchorId, relation])).values()]
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
        }));
    const testObligations = createTestObligations(impacts);

    return {
        version: "v1",
        impacts,
        testObligations,
        impactCoverage: testObligations.map((obligation) => ({
            obligationId: obligation.id,
            status: testInventory.status === "available" ? "not-demonstrated" as const : "not-assessable" as const,
            evidence: [],
            limitation: testInventory.status === "available"
                ? "impact-association-unavailable" as const
                : testInventory.status === "partial"
                    ? "test-inventory-partial" as const
                    : "test-inventory-unavailable" as const,
        })),
        testInventory,
        limitations,
    };
};
