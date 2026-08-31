import { describe, expect, it, vi } from "vitest";
import { LocalGitDiffProvider } from "../src/infrastructure/git/local-git-diff-provider.js";

describe("LocalGitDiffProvider", () => {
    it("loads a three-dot diff and parses changed files", async () => {
        const run = vi.fn()
            .mockResolvedValueOnce("diff --git a/example.ts b/example.ts\n")
            .mockResolvedValueOnce(
                "A\0src/added.ts\0M\0src/modified.ts\0D\0src/deleted.ts\0R100\0src/old.ts\0src/renamed.ts\0",
            );
        const provider = new LocalGitDiffProvider("D:/repository", { run });

        await expect(provider.getCodeChange({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        })).resolves.toEqual({
            diff: "diff --git a/example.ts b/example.ts\n",
            files: [
                { path: "src/added.ts", status: "added" },
                { path: "src/modified.ts", status: "modified" },
                { path: "src/deleted.ts", status: "deleted" },
                { path: "src/renamed.ts", status: "renamed" },
            ],
        });

        expect(run).toHaveBeenNthCalledWith(1, [
            "diff",
            "--no-ext-diff",
            "--binary",
            "main...HEAD",
            "--",
        ]);
    });
});
