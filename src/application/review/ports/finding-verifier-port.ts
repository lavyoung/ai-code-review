import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { ValidatedFinding } from "../../../domain/review/model/review-candidate.js";

/** 一个验证器只能提升已完成变更锚定的发现项，不能创建新发现。 */
export interface FindingVerifier {
    verify(finding: ValidatedFinding, codeChange: CodeChange): ValidatedFinding;
}
