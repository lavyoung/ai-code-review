import type { Severity } from "./severity.js";

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

export interface ReviewAnalysis {
    summary: string;
    findings: ReviewFinding[];
}
