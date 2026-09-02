import {createHmac} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    type CommittedRevisionProvider,
    SandboxedTestResultAnalyzer,
} from "../../../../src/infrastructure/analyzers/sandbox-test/sandbox-test-result-analyzer.js";

const signingSecret = "sandbox-signing-secret";
const sourceRevision = "a".repeat(40);
const temporaryDirectories: string[] = [];

const codeChange = {
    diff: "@@ -0,0 +5,1 @@\n+const result = run();\n",
    files: [{path: "src/example.ts", status: "modified" as const}],
    chunks: [{
        id: "chunk-1",
        path: "src/example.ts",
        newRange: {startLine: 5, endLine: 5},
        content: "@@ -0,0 +5,1 @@\n+const result = run();\n",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

const revisionProvider: CommittedRevisionProvider = {
    resolve: async () => sourceRevision,
};

const writeSignedReport = async (payload: object, signatureSecret = signingSecret): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "aicr-sandbox-test-"));
    temporaryDirectories.push(directory);
    const signature = createHmac("sha256", signatureSecret)
        .update(JSON.stringify(payload), "utf8")
        .digest("hex");
    const path = join(directory, "result.json");
    await writeFile(path, JSON.stringify({payload, signature: `v1=${signature}`}), "utf8");
    return path;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) =>
        rm(directory, {recursive: true, force: true})));
});

describe("SandboxedTestResultAnalyzer", () => {
    it("publishes only signed failures anchored to changed added lines", async () => {
        const path = await writeSignedReport({
            schemaVersion: "v1",
            sourceRevision,
            failures: [{file: "src/example.ts", line: 5, failureCode: "ASSERTION_FAILED"}, {
                file: "src/unchanged.ts", line: 10, failureCode: "token=not-for-output"
            },
            ],
        });
        const analyzer = new SandboxedTestResultAnalyzer({reportPath: path, signingSecret}, revisionProvider);

        const analysis = await analyzer.analyze({codeChange, signal: AbortSignal.timeout(1_000)});

        expect(analysis).toEqual({
            summary: "Sandboxed test results contained 2 failure(s); 1 mapped to changed added lines.",
            findings: [expect.objectContaining({
                severity: "high",
                title: "Sandboxed test failure",
                file: "src/example.ts",
                line: 5,
                chunkId: "chunk-1",
                evidence: "+const result = run();",
            })],
        });
        expect(JSON.stringify(analysis)).not.toContain("ASSERTION_FAILED");
        expect(JSON.stringify(analysis)).not.toContain("token=not-for-output");
    });

    it("rejects an invalid signature or a report for another committed revision", async () => {
        const payload = {
            schemaVersion: "v1",
            sourceRevision,
            failures: [],
        };
        const invalidSignaturePath = await writeSignedReport(payload, "incorrect-secret");
        const analyzer = new SandboxedTestResultAnalyzer({
            reportPath: invalidSignaturePath,
            signingSecret,
        }, revisionProvider);
        await expect(analyzer.analyze({codeChange, signal: AbortSignal.timeout(1_000)}))
            .rejects.toThrow("signature was invalid");

        const stalePath = await writeSignedReport({
            ...payload,
            sourceRevision: "b".repeat(40),
        });
        const staleAnalyzer = new SandboxedTestResultAnalyzer({reportPath: stalePath, signingSecret}, revisionProvider);
        await expect(staleAnalyzer.analyze({codeChange, signal: AbortSignal.timeout(1_000)}))
            .rejects.toThrow("revision did not match");
    });
});
