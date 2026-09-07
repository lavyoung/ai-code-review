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
    /** 仅在提交中存在根 tsconfig 时返回；不可用状态禁止回退到默认类型配置。 */
    typeScriptConfigurationStatus?: "available" | "unavailable";
    /** 仅允许当前 revision 根目录的 TypeScript 配置；适配器不会解析或执行插件。 */
    typeScriptConfiguration?: {
        path: "tsconfig.json";
        content: string;
        /** 仅包含从根配置通过安全相对 `extends` 解析到的已提交父配置。 */
        extendedConfigurations?: readonly {
            path: string;
            content: string;
        }[];
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
