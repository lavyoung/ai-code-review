import {describe, expect, it} from "vitest";
import {
    TypeScriptAstReviewAnalyzer
} from "../../../../src/infrastructure/analyzers/typescript-ast/typescript-ast-review-analyzer.js";

const codeChange = {
    diff: "@@ -0,0 +4,1 @@\n+eval('[REDACTED]');\n",
    files: [{path: "src/example.ts", status: "modified" as const}],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: {startLine: 4, endLine: 4},
        content: "@@ -0,0 +4,1 @@\n+eval('[REDACTED]');\n",
    }],
    excludedFileCount: 1,
    redactedValueCount: 1,
};

describe("TypeScriptAstReviewAnalyzer", () => {
    it("reports only a direct eval call proven in an added TypeScript AST", async () => {
        const analysis = await new TypeScriptAstReviewAnalyzer().analyze({
            rawCodeChange: {
                fileChanges: [{
                    file: {path: "src/example.ts", status: "modified" as const},
                    diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +4,1 @@\n+eval('sk-abcdefgh');\n",
                }],
            },
            codeChange,
            signal: AbortSignal.timeout(1_000),
        });

        expect(analysis).toEqual({
            summary: "TypeScript AST completed with 1 verified candidate(s).",
            findings: [expect.objectContaining({
                severity: "high",
                title: "Unsafe eval call",
                file: "src/example.ts",
                line: 4,
                chunkId: "chunk-1",
                evidence: "+eval('[REDACTED]');",
            })],
        });
        expect(JSON.stringify(analysis)).not.toContain("sk-abcdefgh");
    });

    it("does not inspect sensitive files or non-call text", async () => {
        const analysis = await new TypeScriptAstReviewAnalyzer().analyze({
            rawCodeChange: {
                fileChanges: [{
                    file: {path: ".env.ts", status: "modified" as const},
                    diff: "@@ -0,0 +1 @@\n+eval('untrusted');\n",
                }, {
                    file: {path: "src/example.ts", status: "modified" as const},
                    diff: "@@ -0,0 +4,1 @@\n+const evalName = 'safe';\n",
                }],
            },
            codeChange,
            signal: AbortSignal.timeout(1_000),
        });

        expect(analysis.findings).toEqual([]);
    });

    it("refuses to run without trusted raw input", async () => {
        await expect(new TypeScriptAstReviewAnalyzer().analyze({
            codeChange,
            signal: AbortSignal.timeout(1_000),
        })).rejects.toThrow("trusted raw local input");
    });
});
