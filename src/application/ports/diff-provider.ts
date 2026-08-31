import type { CodeChange } from "../../domain/review/code-change.js";

export type DiffComparison = "two-dot" | "three-dot";

export interface DiffRange {
    baseRef: string;
    headRef: string;
    comparison: DiffComparison;
}

export interface DiffProvider {
    getCodeChange(range: DiffRange): Promise<CodeChange>;
}
