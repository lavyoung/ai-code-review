export const SEVERITIES = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface ReviewConfiguration {
    review: {
        severityThreshold: Severity;
        failOn: Severity[];
    };
    ai: {
        provider: "deepseek";
        model: string;
        timeoutMs: number;
        apiKey?: string;
    };
}