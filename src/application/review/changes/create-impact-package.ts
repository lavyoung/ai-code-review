import type {
    ImpactPackage,
    StaticImpactRelation,
    BusinessContextSummary,
    ExternalConsumerContextSummary,
    StaticTestReference,
    TestExecutionEvidenceSummary,
    TestInventorySummary,
} from "../../../domain/impact/model/impact-package.js";
import {createTestObligations} from "../../../domain/impact/policy/create-test-obligations.js";

const canonicalTypeScriptPath = (path: string): string => path
    .replaceAll("\\", "/")
    .replace(/\.(?:[cm]?[jt]sx?)$/iu, "");

const canonicalJavaClass = (path: string): string | undefined => {
    const match = path.replaceAll("\\", "/").match(/(?:^|\/)src\/(?:main|test)\/java\/(.+)\.java$/u);

    return match?.[1]?.replaceAll("/", ".");
};

const matchesStaticTestReference = (
    relation: StaticImpactRelation,
    reference: StaticTestReference,
): boolean => {
    const isTypeScriptRelation = relation.kind === "module-import" || relation.kind === "typescript-source-change";
    const isJavaRelation = relation.kind === "java-import" || relation.kind === "java-source-change";
    if (isTypeScriptRelation && reference.kind === "module-import") {
        return canonicalTypeScriptPath(relation.sourcePath) === reference.target;
    }
    if (isJavaRelation && reference.kind === "java-import") {
        return canonicalJavaClass(relation.sourcePath) === reference.target;
    }
    // 变更的变量
    const changedSymbol = relation.targetSymbol?.qualifiedName ?? relation.sourceSymbol?.qualifiedName;
    if (changedSymbol === undefined) {
        return false;
    }
    if (relation.sourceSymbol?.language === "typescript" && reference.kind === "typescript-symbol-call"
        || relation.targetSymbol?.language === "typescript" && reference.kind === "typescript-symbol-call"
        || relation.sourceSymbol?.language === "java" && reference.kind === "java-symbol-call"
        || relation.targetSymbol?.language === "java" && reference.kind === "java-symbol-call") {
        return changedSymbol === reference.target;
    }

    return false;
};

const changedSymbolTargets = (relations: readonly StaticImpactRelation[]): readonly string[] => [...new Set(relations
    .filter((relation) => relation.kind === "symbol-change"
        || relation.kind === "typescript-source-change"
        || relation.kind === "java-source-change")
    .map((relation) => relation.targetSymbol?.qualifiedName ?? relation.sourceSymbol?.qualifiedName)
    .filter((target): target is string => target !== undefined))];

const uniqueEvidence = <T extends {kind: string; referenceId: string}>(evidence: readonly T[]): readonly T[] =>
    [...new Map(evidence.map((entry) => [`${entry.kind}:${entry.referenceId}`, entry])).values()];

/** 将已锚定的静态关系压缩成供 AI 消费的影响包，不包含原始 diff 或仓库正文。 */
export const createImpactPackage = (
    relations: readonly StaticImpactRelation[],
    limitations: ImpactPackage["limitations"] = [],
    testInventory: TestInventorySummary = {status: "unavailable", frameworks: [], assetCount: 0, staticReferences: []},
    testExecutionEvidence?: TestExecutionEvidenceSummary,
    businessContext: BusinessContextSummary = {status: "unavailable", associations: []},
    consumerContext: ExternalConsumerContextSummary = {status: "unavailable", associations: []},
    validatedContractRelationIds: readonly string[] = [],
    validatedConsumerCompatibility: readonly {changeAnchorId: string; consumerId: string; consumerSourceRevision: string}[] = [],
): ImpactPackage => {
    const impacts = [...new Map(relations.map((relation) => [relation.changeAnchorId, relation])).values()]
        .map((relation) => {
            const anchoredRelations = relations.filter((candidate) => candidate.changeAnchorId === relation.changeAnchorId);
            const kind = anchoredRelations.some((candidate) => candidate.kind === "contract-definition")
                ? "contract" as const
                : anchoredRelations.some((candidate) => candidate.kind === "configures")
                    ? "configuration" as const
                    : anchoredRelations.some((candidate) => candidate.kind === "persists")
                        ? "persistence" as const
                        : anchoredRelations.some((candidate) => candidate.kind === "publishes" || candidate.kind === "consumes")
                            ? "workflow" as const
                            : "local-behavior" as const;
            return {
                id: `impact:${relation.changeAnchorId}`,
                changeAnchorId: relation.changeAnchorId,
                kind,
                relations: anchoredRelations,
                businessCapabilities: businessContext.associations
                    .filter((association) => association.changeAnchorId === relation.changeAnchorId)
                    .map((association) => association.capability),
                knownConsumers: consumerContext.associations
                    .filter((association) => association.changeAnchorId === relation.changeAnchorId)
                    .map((association) => association.consumer),
                closure: {
                    implementation: "unknown" as const,
                    compatibility: "unknown" as const,
                    validation: "not-assessable" as const,
                },
            };
        });
    const testObligations = createTestObligations(impacts);
    const referencesByImpactId = new Map<string, StaticTestReference[]>();
    for (const impact of impacts) {
        const references = testInventory.staticReferences.filter((reference) =>
            reference.sourceRevision === testInventory.sourceRevision
            && impact.relations.some((relation) => matchesStaticTestReference(relation, reference)),
        );
        referencesByImpactId.set(impact.id, references);
    }

    return {
        version: "v1",
        impacts,
        testObligations,
        impactCoverage: testObligations.map((obligation) => {
            if (obligation.kind === "compatibility") {
                const impact = impacts.find((candidate) => candidate.id === obligation.impactId);
                const consumers = impact?.knownConsumers ?? [];
                const hasValidatedKnownConsumers = consumers.length > 0 && consumers.every((consumer) =>
                    validatedConsumerCompatibility.some((claim) => claim.changeAnchorId === impact?.changeAnchorId
                        && claim.consumerId === consumer.id
                        && claim.consumerSourceRevision === consumer.sourceRevision),
                );
                return {
                    obligationId: obligation.id,
                    ...(hasValidatedKnownConsumers
                        ? {
                            status: "demonstrated" as const,
                            evidence: consumers.map((consumer) => ({
                                kind: "consumer-compatibility" as const,
                                referenceId: `consumer-compatibility:${impact?.id}:${consumer.id}`,
                            })),
                        }
                        : {
                            status: "not-assessable" as const,
                            evidence: [],
                            limitation: "consumer-compatibility-unavailable" as const,
                        }),
                };
            }
            if (obligation.kind === "contract") {
                const impact = impacts.find((candidate) => candidate.id === obligation.impactId);
                const validatedRelation = impact?.relations.find((relation) =>
                    validatedContractRelationIds.includes(relation.id));
                return validatedRelation === undefined
                    ? {
                        obligationId: obligation.id,
                        status: "not-assessable" as const,
                        evidence: [],
                        limitation: "contract-validation-unavailable" as const,
                    }
                    : {
                        obligationId: obligation.id,
                        status: "demonstrated" as const,
                        evidence: [{
                            kind: "contract-validation" as const,
                            referenceId: `contract-validation:${validatedRelation.id}`,
                        }],
                    };
            }
            const references = referencesByImpactId.get(obligation.impactId) ?? [];
            if (testInventory.status !== "available") {
                return {
                    obligationId: obligation.id,
                    status: "not-assessable" as const,
                    evidence: [],
                    limitation: testInventory.status === "partial"
                        ? "test-inventory-partial" as const
                        : "test-inventory-unavailable" as const,
                };
            }
            if (references.length === 0) {
                return {
                    obligationId: obligation.id,
                    status: "not-demonstrated" as const,
                    evidence: [],
                    limitation: "impact-association-unavailable" as const,
                };
            }
            const requiredSymbols = changedSymbolTargets(
                impacts.find((impact) => impact.id === obligation.impactId)?.relations ?? [],
            );
            const directCallReferences = references.filter((reference) => reference.association === "direct-symbol-call");
            const hasCompleteAssociation = requiredSymbols.length > 0 && requiredSymbols.every((symbol) =>
                directCallReferences.some((reference) => reference.target === symbol));
            if (!hasCompleteAssociation) {
                return {
                    obligationId: obligation.id,
                    status: "partial" as const,
                    evidence: references.map((reference) => ({
                        kind: "impact-association" as const,
                        referenceId: reference.id,
                    })),
                    limitation: "impact-association-insufficient" as const,
                };
            }
            const executionMatchesInventory = testExecutionEvidence !== undefined
                && testExecutionEvidence.sourceRevision === testInventory.sourceRevision;
            const passedReferences = executionMatchesInventory
                ? directCallReferences.filter((reference) => testExecutionEvidence.passedTestIds.includes(reference.testId))
                : [];
            const allRequiredSymbolsPassed = requiredSymbols.every((symbol) =>
                passedReferences.some((reference) => reference.target === symbol));
            if (allRequiredSymbolsPassed) {
                return {
                    obligationId: obligation.id,
                    status: "demonstrated" as const,
                    evidence: uniqueEvidence(passedReferences.flatMap((reference) => [
                        {kind: "impact-association" as const, referenceId: reference.id},
                        {kind: "test-execution" as const, referenceId: `test-execution:${reference.testId}`},
                    ])),
                };
            }
            return {
                obligationId: obligation.id,
                status: "partial" as const,
                evidence: directCallReferences.map((reference) => ({
                    kind: "impact-association" as const,
                    referenceId: reference.id,
                })),
                limitation: "test-execution-unavailable" as const,
            };
        }),
        testInventory,
        businessContext,
        consumerContext,
        limitations,
    };
};
