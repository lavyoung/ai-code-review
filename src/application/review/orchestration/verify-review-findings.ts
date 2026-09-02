import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ValidatedFinding } from "../../../domain/review/model/review-candidate.js";
import type { FindingVerifier } from "../ports/finding-verifier-port.js";
import { ReviewVerifierExecutionError } from "../errors/review-execution-error.js";

const preserveFindingIdentity = (
    finding: ValidatedFinding,
    verified: ValidatedFinding,
): ValidatedFinding => ({
    ...finding,
    verificationStatus: finding.verificationStatus === "verified" || verified.verificationStatus === "verified"
        ? "verified"
        : "grounded",
    verificationMethods: [...new Set([...finding.verificationMethods, ...verified.verificationMethods])],
});

/** 按注册顺序应用验证器；验证器只能维持或提升已锚定的发现项。 */
export const verifyReviewFindings = (
    findings: readonly ValidatedFinding[],
    codeChange: CodeChange,
    verifiers: readonly FindingVerifier[],
): ValidatedFinding[] => findings.map((finding) => verifiers.reduce((current, verifier) => {
    try {
        return preserveFindingIdentity(current, verifier.verify(current, codeChange));
    } catch (error) {
        throw new ReviewVerifierExecutionError(verifier.id, error);
    }
}, finding));
