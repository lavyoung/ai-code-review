import type { Severity } from "./severity.js";

export { SEVERITIES } from "./severity.js";
export type { Severity } from "./severity.js";

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
