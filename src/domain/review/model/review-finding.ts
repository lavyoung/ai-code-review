import type { Severity } from "./severity.js";

/**
 * 一条可定位、可执行的代码评审发现项。
 */
export interface ReviewFinding {
    severity: Severity;
    title: string;
    description: string;
    file?: string;
    line?: number;
    category?: string;
    suggestion?: string;
    confidence?: number;
}

/**
 * AI 在策略判定前产出的结构化评审分析。
 */
export interface ReviewAnalysis {
    summary: string;
    findings: ReviewFinding[];
}
