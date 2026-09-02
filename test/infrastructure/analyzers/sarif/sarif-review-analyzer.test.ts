import {fileURLToPath} from "node:url";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPairSync} from "node:crypto";
import {describe, expect, it} from "vitest";
import {SarifReviewAnalyzer} from "../../../../src/infrastructure/analyzers/sarif/sarif-review-analyzer.js";
import {createSarifAttestation} from "../../../../src/infrastructure/analyzers/sarif/sarif-attestation.js";

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

    it("keeps an unattested report advisory", () => {
        expect(new SarifReviewAnalyzer("D:/repository", fixturePath).identity).toEqual({
            kind: "sast",
            id: "sarif",
        });
    });

    it("accepts a report only when its signed attestation matches the checked out revision", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ai-code-review-sarif-"));
        const reportPath = join(directory, "review.sarif");
        const attestationPath = join(directory, "review.sarif.attestation.json");
        const reportContent = await readFile(fixturePath, "utf8");
        const revision = "a".repeat(40);
        const keys = generateKeyPairSync("ed25519");
        const signingPrivateKey = keys.privateKey.export({format: "der", type: "pkcs8"}).toString("base64");
        const verificationPublicKey = keys.publicKey.export({format: "der", type: "spki"}).toString("base64");
        await writeFile(reportPath, reportContent, "utf8");
        await writeFile(attestationPath, JSON.stringify(createSarifAttestation(
            reportContent,
            revision,
            signingPrivateKey,
        )), "utf8");
        const analyzer = new SarifReviewAnalyzer("D:/repository", reportPath, {
            attestationPath,
            verificationPublicKey,
            revisionProvider: {resolve: async () => revision},
        });

        await expect(analyzer.analyze({codeChange, signal: AbortSignal.timeout(1_000)})).resolves.toMatchObject({
            findings: [{title: "SARIF no-eval"}],
        });
        expect(analyzer.identity).toEqual({
            kind: "sast",
            id: "sarif",
            verificationEligible: true,
        });
    });

    it("rejects an attestation for a different report", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ai-code-review-sarif-"));
        const reportPath = join(directory, "review.sarif");
        const attestationPath = join(directory, "review.sarif.attestation.json");
        const reportContent = await readFile(fixturePath, "utf8");
        const revision = "b".repeat(40);
        const keys = generateKeyPairSync("ed25519");
        const signingPrivateKey = keys.privateKey.export({format: "der", type: "pkcs8"}).toString("base64");
        const verificationPublicKey = keys.publicKey.export({format: "der", type: "spki"}).toString("base64");
        await writeFile(reportPath, `${reportContent}\n`, "utf8");
        await writeFile(attestationPath, JSON.stringify(createSarifAttestation(
            reportContent,
            revision,
            signingPrivateKey,
        )), "utf8");
        const analyzer = new SarifReviewAnalyzer("D:/repository", reportPath, {
            attestationPath,
            verificationPublicKey,
            revisionProvider: {resolve: async () => revision},
        });

        await expect(analyzer.analyze({codeChange, signal: AbortSignal.timeout(1_000)}))
            .rejects.toThrow("SARIF attestation did not match");
    });
});
