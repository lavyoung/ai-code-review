import type {RawCodeChange} from "../../../domain/review/model/code-change.js";

/** 仅在本地受信任边界内读取的已提交契约正文；正文不得进入模型或日志。 */
export interface CommittedContractDocument {
    path: string;
    content: string;
}

/** 受资源限制的契约 revision 快照。缺失文档用于表达新增或删除，而不是读取失败。 */
export interface CommittedContractSnapshot {
    status: "available" | "partial" | "unavailable";
    documents: readonly CommittedContractDocument[];
}

/** 从同一 Git 对比范围读取 base/head 契约，禁止回退到未提交工作区。 */
export interface CommittedContractSourcePort {
    read(
        range: NonNullable<RawCodeChange["revisionRange"]>,
        revision: "base" | "head",
        paths: readonly string[],
        signal: AbortSignal,
    ): Promise<CommittedContractSnapshot>;
}
