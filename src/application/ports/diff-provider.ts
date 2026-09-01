import type { CodeChange } from "../../domain/review/code-change.js";

export type DiffComparison = "two-dot" | "three-dot";

/**
 * 两个 Git 引用之间的比较方式。
 */
export interface DiffRange {
    baseRef: string;
    headRef: string;
    comparison: DiffComparison;
}

/**
 * 提供已提交代码变更的应用端口。
 */
export interface DiffProvider {
    /**
     * 获取指定范围内已过滤、已脱敏的代码变更。
     *
     * @param range Git 比较范围。
     * @returns 可安全用于后续评审的代码变更。
     */
    getCodeChange(range: DiffRange): Promise<CodeChange>;
}
