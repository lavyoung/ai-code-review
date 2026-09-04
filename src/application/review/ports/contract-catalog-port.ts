import type {CodeChange, RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {ImpactPackage, StaticImpactRelation} from "../../../domain/impact/model/impact-package.js";

/** 已提交版本中版本化契约改动的安全发现结果；不包含消费者或兼容性结论。 */
export interface ContractCatalogResult {
    relations: readonly StaticImpactRelation[];
    limitations: ImpactPackage["limitations"];
}

/** 只由本地可信适配器实现的契约目录；不得读取未提交工作区。 */
export interface ContractCatalogPort {
    analyze(rawCodeChange: RawCodeChange, codeChange: CodeChange, signal: AbortSignal): Promise<ContractCatalogResult>;
}
