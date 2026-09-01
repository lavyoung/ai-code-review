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

/**
 * 已过滤敏感文件并脱敏文本后的代码变更。
 */
export interface CodeChange {
    diff: string;
    files: ChangedFile[];
    /** 用于模型证据引用的已脱敏变更块。 */
    chunks: DiffChunk[];
    excludedFileCount: number;
    redactedValueCount: number;
}
