export const CHANGE_STATUSES = [
    "added",
    "modified",
    "deleted",
    "renamed",
] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/**
 * 单个已提交文件的变更元数据。
 */
export interface ChangedFile {
    path: string;
    status: ChangeStatus;
    previousPath?: string;
}

/** 已脱敏 diff 中可供外部分析器引用的单个变更块。 */
export interface DiffChunk {
    /** 对安全路径、范围和脱敏内容生成的稳定标识。 */
    id: string;
    path: string;
    newRange?: SourceRange;
    oldRange?: SourceRange;
    /** 已脱敏且仅包含当前 hunk 的文本。 */
    content: string;
}

/** 文件中的连续行范围。 */
export interface SourceRange {
    startLine: number;
    endLine: number;
}

/** 仅可在受信任本地评审边界内使用的原始单文件 Git 变更。 */
export interface RawFileChange {
    file: ChangedFile;
    /** 未脱敏的 Git diff；不得发送到外部服务或写入日志。 */
    diff: string;
}

/**
 * 仅可在受信任本地进程内使用的已提交变更。
 *
 * 该类型禁止进入 AI、日志、评论、通知和反馈存储边界。
 */
export interface RawCodeChange {
    fileChanges: RawFileChange[];
}

/**
 * 可发送给远程分析器、日志和投递渠道的安全代码变更。
 */
export interface CodeChange {
    diff: string;
    files: ChangedFile[];
    /** 用于模型证据引用的已脱敏变更块。 */
    chunks: DiffChunk[];
    excludedFileCount: number;
    redactedValueCount: number;
}

/**
 * 同一次评审的原始与安全输入。
 *
 * 原始变更只可由应用层调度器传递给 `trusted-raw-local` 分析器，绝不能进入
 * 远程 AI、日志、评论、通知、反馈或最终执行结果。
 */
export interface ReviewChangeInput {
    rawCodeChange: RawCodeChange;
    codeChange: CodeChange;
}
