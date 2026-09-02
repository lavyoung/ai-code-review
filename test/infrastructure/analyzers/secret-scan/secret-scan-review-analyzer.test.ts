import { describe, expect, it } from "vitest";
import { SecretScanReviewAnalyzer } from "../../../../src/infrastructure/analyzers/secret-scan/secret-scan-review-analyzer.js";

const codeChange = {
    diff: "@@ -0,0 +4,1 @@\n+const key = '[REDACTED]';\n",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: { startLine: 4, endLine: 4 },
        content: "@@ -0,0 +4,1 @@\n+const key = '[REDACTED]';\n",
    }],
    excludedFileCount: 1,
    redactedValueCount: 1,
};

describe("SecretScanReviewAnalyzer", () => {
    it("maps high-confidence credentials to sanitized anchors only", async () => {
        const analyzer = new SecretScanReviewAnalyzer();
        const rawCodeChange = {
            fileChanges: [{
                file: { path: "src/example.ts", status: "modified" as const },
                diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +4,1 @@\n+const key = 'ghp_123456789012345678901234567890123456';\n",
            }, {
                file: { path: ".env", status: "added" as const },
                diff: "diff --git a/.env b/.env\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+KEY=ghp_123456789012345678901234567890123456\n",
            }],
        };

        const analysis = await analyzer.analyze({
            rawCodeChange,
            codeChange,
            signal: AbortSignal.timeout(1_000),
        });

        expect(analysis).toEqual({
            summary: "Secret scan completed with 1 verified candidate(s).",
            findings: [expect.objectContaining({
                severity: "critical",
                title: "Potential credential committed",
                description: "A high-confidence credential pattern was added to committed code.",
                file: "src/example.ts",
                line: 4,
                chunkId: "chunk-1",
                evidence: "+const key = '[REDACTED]';",
            })],
        });
        expect(JSON.stringify(analysis)).not.toContain("ghp_");
        expect(JSON.stringify(analysis)).not.toContain(".env");
    });

    it("refuses to run without trusted raw input", async () => {
        await expect(new SecretScanReviewAnalyzer().analyze({
            codeChange,
            signal: AbortSignal.timeout(1_000),
        })).rejects.toThrow("trusted raw local input");
    });
});
