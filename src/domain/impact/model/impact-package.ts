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

/** 可发送给 AI 的受限影响摘要；仅包含已锚定关系与明确限制。 */
export interface ImpactPackage {
    version: "v1";
    impacts: readonly ChangeImpact[];
    limitations: readonly (
        | "dynamic-dependency-unavailable"
        | "unsupported-language"
        | "impact-index-unavailable"
    )[];
}
