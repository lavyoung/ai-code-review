import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SarifReviewAnalyzer } from "../../../../src/infrastructure/analyzers/sarif/sarif-review-analyzer.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/sample.sarif.json", import.meta.url));
const codeChange = {
    diff: "@@ -0,0 +4,1 @@\n+eval('sk-example-secret');",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    chunks: [{ id: "chunk-1", path: "src/example.ts", newRange: { startLine: 4, endLine: 4 }, content: "@@ -0,0 +4,1 @@\n+eval('sk-example-secret');" }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("SarifReviewAnalyzer", () => {
    it("imports only changed added-line findings and redacts messages", async () => {
        const analyzer = new SarifReviewAnalyzer("D:/repository", fixturePath);

        await expect(analyzer.analyze({ codeChange, signal: AbortSignal.timeout(1_000) })).resolves.toMatchObject({
            findings: [{
                severity: "high",
                title: "SARIF no-eval",
                description: "Avoid eval with token: [REDACTED]",
                file: "src/example.ts",
                line: 4,
                chunkId: "chunk-1",
            }],
        });
    });
});
