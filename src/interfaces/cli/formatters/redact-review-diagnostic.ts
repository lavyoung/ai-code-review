import {
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";

/**
 * 将适配器诊断收敛为可安全显示在 CI 中的文本。
 *
 * 诊断仅用于排障，不能因为来自受控异常类型就假定其不含密钥或敏感路径。
 */
export const redactReviewDiagnostic = (value: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(value).content);
