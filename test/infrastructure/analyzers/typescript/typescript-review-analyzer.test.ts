import { describe, expect, it, vi } from "vitest";
import { TypeScriptReviewAnalyzer } from "../../../../src/infrastructure/analyzers/typescript/typescript-review-analyzer.js";

const codeChange = {
    diff: "@@ -0,0 +4,1 @@\n+const count: number = 'sk-secret-token';",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: { startLine: 4, endLine: 4 },
        content: "@@ -0,0 +4,1 @@\n+const count: number = 'sk-secret-token';",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("TypeScriptReviewAnalyzer", () => {
    it("maps only added-line diagnostics and redacts diagnostic text", async () => {
        const commandRunner = {
            run: vi.fn().mockResolvedValue({
                exitCode: 2,
                output: [
                    "D:/repository/src/example.ts(4,7): error TS2322: Type 'sk-secret-token' is not assignable to type 'number'.",
                    "D:/repository/src/example.ts(2,7): error TS6133: 'oldValue' is declared but its value is never read.",
                ].join("\n"),
            }),
        };
        const analyzer = new TypeScriptReviewAnalyzer("D:/repository", commandRunner);

        await expect(analyzer.analyze({ codeChange, signal: AbortSignal.timeout(1_000) }))
            .resolves.toMatchObject({
                summary: "TypeScript completed with 2 diagnostic(s); 1 mapped to changed added lines.",
                findings: [{
                    severity: "high",
                    title: "TypeScript error TS2322",
                    description: "Type '[REDACTED]' is not assignable to type 'number'.",
                    file: "src/example.ts",
                    line: 4,
                    chunkId: "chunk-1",
                    evidence: "+const count: number = 'sk-secret-token';",
                }],
            });
    });

    it("fails rather than hiding a TypeScript project configuration error", async () => {
        const analyzer = new TypeScriptReviewAnalyzer("D:/repository", {
            run: vi.fn().mockResolvedValue({
                exitCode: 1,
                output: "error TS5058: The specified path does not exist: 'tsconfig.json'.",
            }),
        });

        await expect(analyzer.analyze({ codeChange, signal: AbortSignal.timeout(1_000) }))
            .rejects.toThrow("TypeScript did not return file diagnostics");
    });
});
