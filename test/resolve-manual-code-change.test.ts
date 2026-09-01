import { describe, expect, it, vi } from "vitest";
import { resolveManualCodeChange } from "../src/application/resolve-manual-code-change.js";

describe("resolveManualCodeChange", () => {
    it("requests committed changes from the target merge base to HEAD", async () => {
        const expectedChange = {
            diff: "",
            files: [],
            excludedFileCount: 0,
            redactedValueCount: 0,
        };
        const getCodeChange = vi.fn().mockResolvedValue(expectedChange);

        await expect(resolveManualCodeChange(
            { getCodeChange },
            "main",
        )).resolves.toBe(expectedChange);

        expect(getCodeChange).toHaveBeenCalledWith({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });
    });
});
