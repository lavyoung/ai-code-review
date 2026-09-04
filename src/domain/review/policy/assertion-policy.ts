import type {AssertionType, FindingVerificationMethod, ReviewAssertion, ReviewFact} from "../model/review-candidate.js";
import type {Severity} from "../model/severity.js";

/** 断言类别的验证要求只能由该受控策略定义，不能由模型响应覆盖。 */
export interface AssertionPolicy {
    type: AssertionType;
    /** 系统给出的建议排序级别；它不是模型输入，也不能单独参与门禁。 */
    advisorySeverity: Severity;
    requiredFactKinds: readonly ReviewFact["kind"][];
    requiredVerificationMethods: readonly FindingVerificationMethod[];
    gateEligible: boolean;
}

const policies: Record<AssertionType, AssertionPolicy> = {
    "impact-closure": {
        type: "impact-closure",
        advisorySeverity: "low",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
    "regression-risk": {
        type: "regression-risk",
        advisorySeverity: "medium",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
    "contract-compatibility": {
        type: "contract-compatibility",
        advisorySeverity: "medium",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
    "test-obligation": {
        type: "test-obligation",
        advisorySeverity: "low",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
    "security-risk": {
        type: "security-risk",
        advisorySeverity: "medium",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
    "design-maintainability": {
        type: "design-maintainability",
        advisorySeverity: "low",
        requiredFactKinds: ["diff-anchor", "evidence-match"],
        requiredVerificationMethods: ["diff-anchor", "evidence-match"],
        gateEligible: false,
    },
};

/** 返回不可变的系统验证策略。 */
export const resolveAssertionPolicy = (type: AssertionType): AssertionPolicy => policies[type];

/** 未被模型分类的候选保持保守的人工审查建议类别。 */
export const resolveAssertionType = (assertionType: AssertionType | undefined): AssertionType =>
    assertionType ?? "design-maintainability";

/** 将模型建议转换为系统拥有的断言，防止模型声明门禁或验证方法。 */
export const createReviewAssertion = (
    assertionType: AssertionType | undefined,
    author: ReviewAssertion["author"],
    facts: readonly ReviewFact[],
): ReviewAssertion => ({
    type: resolveAssertionType(assertionType),
    author,
    factIds: facts.map((fact) => fact.id),
    uncertainty: "none",
});
