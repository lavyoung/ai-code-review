export const CHANGE_STATUSES = [
    "added",
    "modified",
    "deleted",
    "renamed",
] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface ChangedFile {
    path: string;
    status: ChangeStatus;
}

export interface CodeChange {
    diff: string;
    files: ChangedFile[];
}
