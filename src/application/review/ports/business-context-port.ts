import type {CodeChange} from "../../../domain/review/model/code-change.js";
import type {BusinessContextSummary} from "../../../domain/impact/model/impact-package.js";

/** 受控业务能力目录的查询端口；未通过治理校验时必须降级为不可用。 */
export interface BusinessContextPort {
    resolve(codeChange: CodeChange, signal: AbortSignal): Promise<BusinessContextSummary>;
}
