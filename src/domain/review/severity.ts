export const SEVERITIES = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
] as const;

export type Severity = (typeof SEVERITIES)[number];
