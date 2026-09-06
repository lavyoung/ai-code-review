import type {RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {SymbolIdentity} from "../../../domain/impact/model/impact-package.js";

/** 仅在本地受信任边界内存在的已提交源码；正文不得进入模型、日志或投递。 */
export interface CommittedSourceFile {
    path: string;
    language: SymbolIdentity["language"];
    content: string;
}

/** 有资源上限的 revision 源码快照。 */
export interface CommittedRevisionSourceSnapshot {
    status: "available" | "partial" | "unavailable";
    files: readonly CommittedSourceFile[];
    /** 仅允许当前 revision 根目录的 TypeScript 配置；适配器不会解析或执行插件。 */
    typeScriptConfiguration?: {
        path: "tsconfig.json";
        content: string;
    };
}

/** 读取 Git 对比范围实际 base/head 中的受支持源码，不得读取工作区文件。 */
export interface CommittedRevisionSourcePort {
    read(
        range: NonNullable<RawCodeChange["revisionRange"]>,
        revision: "base" | "head",
        signal: AbortSignal,
    ): Promise<CommittedRevisionSourceSnapshot>;
}
