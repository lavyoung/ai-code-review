import { describe, expect, it } from "vitest";
import { createSanitizedCodeChange } from "../../../../src/application/review/changes/create-sanitized-code-change.js";

describe("createSanitizedCodeChange", () => {
    it("filters sensitive files before redacting and chunking model input", () => {
        const change = createSanitizedCodeChange({
            fileChanges: [{
                file: { path: ".env", status: "added" },
                diff: "diff --git a/.env b/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=raw-value\n",
            }, {
                file: { path: "src/example.ts", status: "modified" },
                diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+const token = 'raw-value';\n",
            }],
        });

        expect(change).toMatchObject({
            files: [{ path: "src/example.ts", status: "modified" }],
            excludedFileCount: 1,
            redactedValueCount: 1,
            chunks: [{
                id: expect.any(String),
                path: "src/example.ts",
                content: "@@ -0,0 +1 @@\n+const token = '[REDACTED]';\n",
            }],
        });
        expect(change.diff).not.toContain(".env");
        expect(change.diff).not.toContain("raw-value");
    });
});
