import {describe, expect, it} from "vitest";
import {JavaAstReviewAnalyzer} from "../../../../src/infrastructure/analyzers/java-ast/java-ast-review-analyzer.js";

const codeChange = {
    diff: "@@ -0,0 +4,1 @@\n+Runtime.getRuntime().exec(\"[REDACTED]\");\n",
    files: [{path: "src/example.java", status: "modified" as const}],
    chunks: [{
        id: "chunk-1",
        path: "src/example.java",
        newRange: {startLine: 4, endLine: 4},
        content: "@@ -0,0 +4,1 @@\n+Runtime.getRuntime().exec(\"[REDACTED]\");\n",
    }],
    excludedFileCount: 0,
    redactedValueCount: 1,
};

describe("JavaAstReviewAnalyzer", () => {
    it("reports a parsed direct Runtime command execution call on an added Java line", async () => {
        const analysis = await new JavaAstReviewAnalyzer().analyze({
            rawCodeChange: {
                fileChanges: [{
                    file: {path: "src/example.java", status: "modified" as const},
                    diff: "@@ -0,0 +4,1 @@\n+Runtime.getRuntime().exec(\"secret-command\");\n",
                }],
            },
            codeChange,
            signal: AbortSignal.timeout(1_000),
        });

        expect(analysis).toEqual({
            summary: "Java AST completed with 1 advisory candidate(s).",
            findings: [expect.objectContaining({
                severity: "high",
                title: "Runtime command execution introduced",
                file: "src/example.java",
                line: 4,
                chunkId: "chunk-1",
                evidence: "+Runtime.getRuntime().exec(\"[REDACTED]\");",
            })],
        });
        expect(JSON.stringify(analysis)).not.toContain("secret-command");
    });

    it("does not report comments, strings, sensitive files, or non-Java files", async () => {
        const analysis = await new JavaAstReviewAnalyzer().analyze({
            rawCodeChange: {
                fileChanges: [{
                    file: {path: "src/example.java", status: "modified" as const},
                    diff: "@@ -0,0 +4,1 @@\n+// Runtime.getRuntime().exec(\"ignored\");\n@@ -0,0 +5,1 @@\n+String text = \"Runtime.getRuntime().exec\";\n",
                }, {
                    file: {path: ".env.java", status: "modified" as const},
                    diff: "@@ -0,0 +1,1 @@\n+Runtime.getRuntime().exec(\"ignored\");\n",
                }, {
                    file: {path: "src/example.txt", status: "modified" as const},
                    diff: "@@ -0,0 +1,1 @@\n+Runtime.getRuntime().exec(\"ignored\");\n",
                }],
            },
            codeChange,
            signal: AbortSignal.timeout(1_000),
        });

        expect(analysis.findings).toEqual([]);
    });

    it("refuses to run without trusted raw input", async () => {
        await expect(new JavaAstReviewAnalyzer().analyze({
            codeChange,
            signal: AbortSignal.timeout(1_000),
        })).rejects.toThrow("trusted raw local input");
    });
});
