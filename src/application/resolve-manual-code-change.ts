import type { CodeChange } from "../domain/review/code-change.js";
import type { DiffProvider } from "./ports/diff-provider.js";

export const resolveManualCodeChange = (
    diffProvider: DiffProvider,
    target: string,
): Promise<CodeChange> => diffProvider.getCodeChange({
    baseRef: target,
    headRef: "HEAD",
    comparison: "three-dot",
});
