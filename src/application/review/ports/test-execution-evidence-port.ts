import type {TestExecutionEvidenceSummary} from "../../../domain/impact/model/impact-package.js";

/** 只读取已验签、与当前提交匹配的受控测试通过证明。 */
export interface TestExecutionEvidencePort {
    read(signal: AbortSignal): Promise<TestExecutionEvidenceSummary>;
}
