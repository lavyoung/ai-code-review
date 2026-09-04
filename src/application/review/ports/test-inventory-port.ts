import type {TestInventorySummary} from "../../../domain/impact/model/impact-package.js";

/** 已提交版本中的测试资产发现；不执行仓库脚本，也不产生覆盖结论。 */
export interface TestInventoryPort {
    discover(signal: AbortSignal): Promise<TestInventorySummary>;
}
