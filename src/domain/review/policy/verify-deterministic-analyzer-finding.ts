import type {ValidatedFinding} from "../model/review-candidate.js";

const deterministicAnalyzerKinds = new Set([
    "ast",
    "sast",
    "linter",
    "typecheck",
    "test",
    "secret-scan",
]);

/**
 * 将由受信任、本地确定性分析器产生且已锚定的发现升级为 `verified`。
 *
 * AI 发现无论置信度多高都不会经过此验证器升级；它们仍需独立的 AST、
 * 类型检查或受限测试验证器支持。
 */
export const verifyDeterministicAnalyzerFinding = (
    finding: ValidatedFinding,
): ValidatedFinding => {
    if (finding.analyzer === undefined || !deterministicAnalyzerKinds.has(finding.analyzer.kind)) {
        return finding;
    }

    return {
        ...finding,
        verificationStatus: "verified",
        verificationMethods: [
            ...finding.verificationMethods,
            ...(finding.analyzer.kind === "ast" ? ["ast" as const] : []),
            "deterministic-analyzer",
        ],
    };
};
