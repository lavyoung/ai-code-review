import type {CodeChange, RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {ImpactPackage, StaticImpactRelation} from "../../../domain/impact/model/impact-package.js";

/** 索引结果必须显式说明无法覆盖的语言或动态依赖。 */
export interface SemanticImpactIndexResult {
    relations: readonly StaticImpactRelation[];
    limitations: ImpactPackage["limitations"];
}

/** 仅由本地受信任适配器实现的静态关系索引。 */
export interface SemanticImpactIndexPort {
    analyze(
        rawCodeChange: RawCodeChange,
        codeChange: CodeChange,
        signal: AbortSignal,
    ): Promise<SemanticImpactIndexResult>;
}
