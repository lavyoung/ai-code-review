import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { DiffProvider } from "../ports/diff-provider.js";
import { createSanitizedCodeChange } from "../changes/create-sanitized-code-change.js";

/**
 * 解析手动评审的已提交变更。
 *
 * @param diffProvider 获取变更的基础设施端口实现。
 * @param target 与当前 `HEAD` 比较的目标分支或提交。
 * @returns 目标合并基点到 `HEAD` 的三点 diff。
 */
export const resolveManualCodeChange = (
    diffProvider: DiffProvider,
    target: string,
): Promise<CodeChange> => diffProvider.getRawCodeChange({
    baseRef: target,
    headRef: "HEAD",
    comparison: "three-dot",
}).then(createSanitizedCodeChange);
