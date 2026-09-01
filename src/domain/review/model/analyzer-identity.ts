/** 分析器的规范化来源身份；不携带供应商协议或运行时细节。 */
export interface AnalyzerIdentity {
    kind: "ai" | "sast" | "linter" | "typecheck" | "test" | "secret-scan";
    id: string;
    version?: string;
}
