import { describe, expect, it, vi } from "vitest";
import { resolvePullRequestCodeChange } from "../../../../src/application/review/use-cases/resolve-pull-request-code-change.js";

describe("resolvePullRequestCodeChange", () => {
    it("requests the committed base-to-head three-dot range", async () => {
        const codeChange = {
            diff: "",
            files: [],
            excludedFileCount: 0,
            redactedValueCount: 0,
        };
        const getCodeChange = vi.fn().mockResolvedValue(codeChange);

        await expect(resolvePullRequestCodeChange({ getCodeChange }, {
            baseSha: "base-sha",
            headSha: "head-sha",
        })).resolves.toBe(codeChange);

        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "base-sha",
            headRef: "head-sha",
            comparison: "three-dot",
        });
    });
});
