import type { RawCodeChange } from "../../../domain/review/model/code-change.js";

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
 * 提供仅限受信任本地边界使用的已提交原始变更的应用端口。
 */
export interface DiffProvider {
    /**
     * 获取指定范围内的原始已提交变更。
     *
     * @param range Git 比较范围。
     * @returns 仅可交给安全投影步骤的原始变更。
     */
    getRawCodeChange(range: DiffRange): Promise<RawCodeChange>;
}
