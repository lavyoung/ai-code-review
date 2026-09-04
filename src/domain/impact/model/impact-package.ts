/** 对外可用的静态影响关系类型；动态分派必须显式保持未知。 */
export type ImpactRelationKind = "module-import" | "java-import";

/** 可安全引用本次变更的单条静态关系，不保存源文件正文。 */
export interface StaticImpactRelation {
    id: string;
    changeAnchorId: string;
    sourcePath: string;
    sourceLine: number;
    target: string;
    kind: ImpactRelationKind;
    completeness: "complete" | "partial" | "unknown";
}

/** 当前变更可追溯的影响结论；它不宣称运行时行为或完整调用图。 */
export interface ChangeImpact {
    id: string;
    changeAnchorId: string;
    kind: "local-behavior" | "configuration" | "workflow";
    relations: readonly StaticImpactRelation[];
    closure: {
        implementation: "unknown";
        compatibility: "unknown";
        validation: "not-assessable";
    };
}

/** 一项由已知影响路径导出的最小验证目标；它不是“测试缺失”的断言。 */
export interface TestObligation {
    id: string;
    impactId: string;
    kind: "happy-path" | "contract" | "authorization" | "persistence" | "compatibility";
    rationale: string;
    requiredEvidence: readonly ("test-execution" | "impact-association")[];
}

/** 可追溯的测试覆盖证明引用；当前发现阶段尚不产生此类证明。 */
export interface TestCoverageEvidenceReference {
    kind: "test-execution" | "impact-association";
    referenceId: string;
}

/** 某项测试义务当前可证明的覆盖状态；没有测试清单时必须保持不可评估。 */
export interface ImpactCoverage {
    obligationId: string;
    status: "demonstrated" | "partial" | "not-demonstrated" | "not-assessable";
    evidence: readonly TestCoverageEvidenceReference[];
    limitation?: "test-inventory-unavailable" | "test-inventory-partial" | "impact-association-unavailable";
}

/** 测试资产发现的安全摘要；既不包含测试正文，也不把名称当作覆盖证明。 */
export interface TestInventorySummary {
    status: "available" | "partial" | "unavailable";
    frameworks: readonly ("vitest" | "jest" | "junit")[];
    assetCount: number;
}

/** 可发送给 AI 的受限影响摘要；仅包含已锚定关系与明确限制。 */
export interface ImpactPackage {
    version: "v1";
    impacts: readonly ChangeImpact[];
    testObligations: readonly TestObligation[];
    impactCoverage: readonly ImpactCoverage[];
    testInventory: TestInventorySummary;
    limitations: readonly (
        | "dynamic-dependency-unavailable"
        | "unsupported-language"
        | "impact-index-unavailable"
    )[];
}
