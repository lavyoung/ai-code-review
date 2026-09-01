import { describe, expect, it, vi } from "vitest";
import { LocalGitDiffProvider } from "../../../../src/infrastructure/scm/git/local-git-diff-provider.js";

describe("LocalGitDiffProvider", () => {
    it("excludes sensitive files and redacts sensitive values", async () => {
        const run = vi.fn()
            .mockResolvedValueOnce(
                "A\0.env\0M\0src/modified.ts\0D\0src/deleted.ts\0R100\0secrets.json\0src/renamed.ts\0",
            )
            .mockResolvedValueOnce(
                "diff --git a/src/modified.ts b/src/modified.ts\n--- a/src/modified.ts\n+++ b/src/modified.ts\n@@ -0,0 +1,3 @@\n+api_key: exposed-value\n+Authorization: Bearer token-value\n+const key = 'sk-abcdefghijk'\n",
            );
        const provider = new LocalGitDiffProvider("D:/repository", { run });

        const change = await provider.getCodeChange({
            baseRef: "main",
            headRef: "HEAD",
            comparison: "three-dot",
        });

        expect(change).toMatchObject({
            diff: "diff --git a/src/modified.ts b/src/modified.ts\n--- a/src/modified.ts\n+++ b/src/modified.ts\n@@ -0,0 +1,3 @@\n+api_key: [REDACTED]\n+Authorization: Bearer [REDACTED]\n+const key = '[REDACTED]'\n",
            files: [
                { path: "src/modified.ts", status: "modified" },
                { path: "src/deleted.ts", status: "deleted" },
            ],
            chunks: [{
                id: expect.any(String),
                path: "src/modified.ts",
                newRange: { startLine: 1, endLine: 3 },
                content: "@@ -0,0 +1,3 @@\n+api_key: [REDACTED]\n+Authorization: Bearer [REDACTED]\n+const key = '[REDACTED]'\n",
            }],
            excludedFileCount: 2,
            redactedValueCount: 3,
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
            "src/modified.ts",
            "src/deleted.ts",
        ]);
    });
});
