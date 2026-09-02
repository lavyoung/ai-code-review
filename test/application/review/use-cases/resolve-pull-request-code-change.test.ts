import { describe, expect, it, vi } from "vitest";
import { resolvePullRequestCodeChange } from "../../../../src/application/review/use-cases/resolve-pull-request-code-change.js";

describe("resolvePullRequestCodeChange", () => {
    it("requests the committed base-to-head three-dot range", async () => {
        const rawCodeChange = {
            fileChanges: [],
        };
        const getRawCodeChange = vi.fn().mockResolvedValue(rawCodeChange);

        await expect(resolvePullRequestCodeChange({ getRawCodeChange }, {
            baseSha: "base-sha",
            headSha: "head-sha",
        })).resolves.toEqual({
            rawCodeChange,
            codeChange: {
                diff: "",
                files: [],
                chunks: [],
                excludedFileCount: 0,
                redactedValueCount: 0,
            },
        });

        expect(getRawCodeChange).toHaveBeenCalledWith({
            baseRef: "base-sha",
            headRef: "head-sha",
            comparison: "three-dot",
        });
    });
});
