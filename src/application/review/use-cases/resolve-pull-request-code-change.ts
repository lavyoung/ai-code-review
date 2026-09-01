import type { CodeChange } from "../../../domain/review/model/code-change.js";
import type { DiffProvider } from "../ports/diff-provider.js";
import { createSanitizedCodeChange } from "../changes/create-sanitized-code-change.js";

/** Pull Request 评审的已提交范围。 */
export interface PullRequestCodeChangeRange {
    baseSha: string;
    headSha: string;
}

/**
 * 解析 PR 源提交相对于目标提交的三点 diff。
 */
export const resolvePullRequestCodeChange = (
    diffProvider: DiffProvider,
    range: PullRequestCodeChangeRange,
): Promise<CodeChange> => diffProvider.getRawCodeChange({
    baseRef: range.baseSha,
    headRef: range.headSha,
    comparison: "three-dot",
}).then(createSanitizedCodeChange);
