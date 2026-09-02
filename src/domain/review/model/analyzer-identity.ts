/** 分析器的规范化来源身份；不携带供应商协议或运行时细节。 */
export interface AnalyzerIdentity {
    kind: "ai" | "ast" | "sast" | "linter" | "typecheck" | "test" | "secret-scan";
    id: string;
    version?: string;
    /** 仅由 bootstrap 信任的确定性来源可声明；解析性建议不能据此绕过人工评审。 */
    verificationEligible?: boolean;
}
