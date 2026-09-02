import { describe, expect, it, vi } from "vitest";
import { LocalGitDiffProvider } from "../../../../src/infrastructure/scm/git/local-git-diff-provider.js";

describe("LocalGitDiffProvider", () => {
    it("returns raw committed file changes only to the local safety boundary", async () => {
        const run = vi.fn()
            .mockResolvedValueOnce(
                "A\0.env\0M\0src/modified.ts\0D\0src/deleted.ts\0R100\0secrets.json\0src/renamed.ts\0",
            )
            .mockResolvedValueOnce(
                "diff --git a/src/modified.ts b/src/modified.ts\n--- a/src/modified.ts\n+++ b/src/modified.ts\n@@ -0,0 +1,3 @@\n+api_key: exposed-value\n+Authorization: Bearer token-value\n+const key = 'sk-abcdefghijk'\n",
            );
        const provider = new LocalGitDiffProvider("D:/repository", { run });

        const change = await provider.getRawCodeChange({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });

        expect(change).toMatchObject({
            fileChanges: expect.arrayContaining([{
                file: { path: ".env", status: "added" },
                diff: "",
            }, {
                file: { path: "src/modified.ts", status: "modified" },
                diff: "diff --git a/src/modified.ts b/src/modified.ts\n--- a/src/modified.ts\n+++ b/src/modified.ts\n@@ -0,0 +1,3 @@\n+api_key: exposed-value\n+Authorization: Bearer token-value\n+const key = 'sk-abcdefghijk'\n",
            }]),
        });

        expect(run).toHaveBeenNthCalledWith(1, [
            "diff",
            "--name-status",
            "--find-renames",
            "-z",
            "main...HEAD",
            "--",
        ]);
        expect(run).toHaveBeenNthCalledWith(2, [
            "diff",
            "--no-ext-diff",
            "--binary",
            "main...HEAD",
            "--",
            ".env",
            "src/modified.ts",
            "src/deleted.ts",
            "src/renamed.ts",
        ]);
    });
});
