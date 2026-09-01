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

/**
 * 已过滤敏感文件并脱敏文本后的代码变更。
 */
export interface CodeChange {
    diff: string;
    files: ChangedFile[];
    excludedFileCount: number;
    redactedValueCount: number;
}
