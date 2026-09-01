import { describe, expect, it, vi } from "vitest";
import { resolveManualCodeChange } from "../../../../src/application/review/use-cases/resolve-manual-code-change.js";

describe("resolveManualCodeChange", () => {
    it("requests committed changes from the target merge base to HEAD", async () => {
        const rawChange = {
            fileChanges: [],
        };
        const getRawCodeChange = vi.fn().mockResolvedValue(rawChange);

        await expect(resolveManualCodeChange(
            { getRawCodeChange },
            "main",
        )).resolves.toEqual({
            diff: "",
            files: [],
            chunks: [],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(getRawCodeChange).toHaveBeenCalledWith({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });
    });
});
