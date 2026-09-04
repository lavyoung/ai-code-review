import {createHmac} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {SignedSandboxTestExecutionEvidence} from "../../../src/infrastructure/impact/signed-sandbox-test-execution-evidence.js";
import {createOpaqueTestAssetId} from "../../../src/infrastructure/impact/test-asset-identity.js";

const signingSecret = "sandbox-signing-secret";
const revision = "a".repeat(40);
const directories: string[] = [];

const writeReport = async (payload: object): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "aicr-sandbox-evidence-"));
    directories.push(directory);
    const signature = createHmac("sha256", signingSecret).update(JSON.stringify(payload), "utf8").digest("hex");
    const path = join(directory, "report.json");
    await writeFile(path, JSON.stringify({payload, signature: `v1=${signature}`}), "utf8");
    return path;
};

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true}))));

describe("SignedSandboxTestExecutionEvidence", () => {
    it("projects signed passing tests for the current revision into opaque IDs", async () => {
        const path = await writeReport({
            schemaVersion: "v1",
            sourceRevision: revision,
            failures: [],
            passedTests: [{file: "tests/example.test.ts"}],
        });
        const evidence = new SignedSandboxTestExecutionEvidence({reportPath: path, signingSecret}, {
            resolve: async () => revision,
        });

        await expect(evidence.readPassedTestIds(AbortSignal.timeout(1_000)))
            .resolves.toEqual([createOpaqueTestAssetId("tests/example.test.ts")]);
    });

    it("accepts a legacy report but gives no passing-test proof", async () => {
        const path = await writeReport({schemaVersion: "v1", sourceRevision: revision, failures: []});
        const evidence = new SignedSandboxTestExecutionEvidence({reportPath: path, signingSecret}, {
            resolve: async () => revision,
        });

        await expect(evidence.readPassedTestIds(AbortSignal.timeout(1_000))).resolves.toEqual([]);
    });
});
