import type {ChangeImpact, TestObligation} from "../model/impact-package.js";

/**
 * 从已锚定的技术影响生成最小验证义务。
 *
 * 该策略只描述应寻找何种证明，绝不根据本次是否修改测试文件推断“缺少测试”。
 */
export const createTestObligations = (
    impacts: readonly ChangeImpact[],
): readonly TestObligation[] => impacts.flatMap((impact): readonly TestObligation[] => {
    if (impact.relations.length === 0) {
        return [];
    }
    if (impact.kind === "contract") {
        return [{
            id: `test-obligation:${impact.id}:contract`,
            impactId: impact.id,
            kind: "contract" as const,
            rationale: "A versioned contract changed; verify the changed contract on the current revision.",
            requiredEvidence: ["contract-validation"] as const,
        }, {
            id: `test-obligation:${impact.id}:compatibility`,
            impactId: impact.id,
            kind: "compatibility" as const,
            rationale: "A versioned contract changed; obtain explicit compatibility evidence for known consumers.",
            requiredEvidence: ["contract-validation"] as const,
        }];
    }
    return [{
        id: `test-obligation:${impact.id}:happy-path`,
        impactId: impact.id,
        kind: "happy-path" as const,
        rationale: "A committed change has an anchored static dependency relation; verify its affected behavior on the current revision.",
        requiredEvidence: ["test-execution", "impact-association"] as const,
    }];
});
