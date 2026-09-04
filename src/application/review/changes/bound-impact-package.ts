import type {ImpactPackage} from "../../../domain/impact/model/impact-package.js";

const serializedLength = (value: unknown): number => JSON.stringify(value).length;

/**
 * 在远程模型输入预算内保留按变更顺序排列的安全影响摘要。
 *
 * 被裁剪的影响不代表不存在，因此必须追加明确限制；若连最小安全摘要都无法容纳，则不发送影响包。
 */
export const boundImpactPackage = (
    impactPackage: ImpactPackage,
    permittedChunkIds: ReadonlySet<string>,
    maxSerializedLength: number,
): ImpactPackage | undefined => {
    const availableImpacts = impactPackage.impacts.filter((impact) => permittedChunkIds.has(impact.changeAnchorId));
    const base = {
        version: impactPackage.version,
        impacts: [],
        testObligations: [],
        impactCoverage: [],
        testInventory: {...impactPackage.testInventory, staticReferences: []},
        businessContext: {status: impactPackage.businessContext.status, associations: []},
        consumerContext: {status: impactPackage.consumerContext.status, associations: []},
        limitations: impactPackage.limitations,
    } satisfies ImpactPackage;
    if (serializedLength(base) > maxSerializedLength) {
        return undefined;
    }

    const impacts: ImpactPackage["impacts"][number][] = [];
    for (const impact of availableImpacts) {
        const obligationIds = new Set(impactPackage.testObligations
            .filter((obligation) => obligation.impactId === impact.id)
            .map((obligation) => obligation.id));
        const candidate = {
            ...base,
            impacts: [...impacts, impact],
            testObligations: impactPackage.testObligations.filter((obligation) => obligationIds.has(obligation.id)
                || impacts.some((included) => obligation.impactId === included.id)),
            impactCoverage: impactPackage.impactCoverage.filter((coverage) => obligationIds.has(coverage.obligationId)
                || impactPackage.testObligations.some((obligation) => impacts.some((included) => obligation.impactId === included.id)
                    && obligation.id === coverage.obligationId)),
            businessContext: {
                status: impactPackage.businessContext.status,
                associations: impactPackage.businessContext.associations.filter((association) =>
                    [...impacts, impact].some((included) => included.changeAnchorId === association.changeAnchorId)),
            },
            consumerContext: {
                status: impactPackage.consumerContext.status,
                associations: impactPackage.consumerContext.associations.filter((association) =>
                    [...impacts, impact].some((included) => included.changeAnchorId === association.changeAnchorId)),
            },
        } satisfies ImpactPackage;
        if (serializedLength(candidate) > maxSerializedLength) {
            break;
        }
        impacts.push(impact);
    }
    const includedImpactIds = new Set(impacts.map((impact) => impact.id));
    const truncated = impacts.length < availableImpacts.length || availableImpacts.length < impactPackage.impacts.length;
    const limitations = truncated
        ? [...impactPackage.limitations, "impact-package-truncated" as const]
        : impactPackage.limitations;
    const result: ImpactPackage = {
        ...base,
        impacts,
        testObligations: impactPackage.testObligations.filter((obligation) => includedImpactIds.has(obligation.impactId)),
        impactCoverage: impactPackage.impactCoverage.filter((coverage) => impactPackage.testObligations.some((obligation) =>
            obligation.id === coverage.obligationId && includedImpactIds.has(obligation.impactId))),
        businessContext: {
            status: impactPackage.businessContext.status,
            associations: impactPackage.businessContext.associations.filter((association) =>
                impacts.some((impact) => impact.changeAnchorId === association.changeAnchorId)),
        },
        consumerContext: {
            status: impactPackage.consumerContext.status,
            associations: impactPackage.consumerContext.associations.filter((association) =>
                impacts.some((impact) => impact.changeAnchorId === association.changeAnchorId)),
        },
        limitations,
    };
    return serializedLength(result) <= maxSerializedLength ? result : undefined;
};
