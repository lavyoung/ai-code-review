import {execFile} from "node:child_process";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";
import {CommittedTestInventory} from "../../../src/infrastructure/impact/committed-test-inventory.js";

const execFileAsync = promisify(execFile);
const temporaryRepositories: string[] = [];

const git = async (directory: string, ...arguments_: string[]): Promise<void> => {
    await execFileAsync("git", arguments_, {cwd: directory});
};

afterEach(async () => {
    await Promise.all(temporaryRepositories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("CommittedTestInventory", () => {
    it("discovers supported test frameworks only from committed, non-sensitive test assets", async () => {
        const directory = await mkdtemp(join(tmpdir(), "ai-code-review-test-inventory-"));
        temporaryRepositories.push(directory);
        await git(directory, "init");
        await mkdir(join(directory, "tests"), {recursive: true});
        await mkdir(join(directory, "src", "test", "java", "example"), {recursive: true});
        await writeFile(join(directory, "tests", "example.test.ts"), 'import {it} from "vitest";\nimport {example} from "../src/example.js";\nit("works", () => example());\n', "utf8");
        await writeFile(join(directory, "src", "test", "java", "example", "ExampleTest.java"), 'import org.junit.jupiter.api.Test;\nclass ExampleTest {}\n', "utf8");
        await writeFile(join(directory, "tests", "secret.env"), "API_KEY=must-not-be-read", "utf8");
        await git(directory, "add", ".");
        await git(directory, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");

        await expect(new CommittedTestInventory(directory).discover(AbortSignal.timeout(5_000))).resolves.toEqual({
            status: "available",
            frameworks: expect.arrayContaining(["vitest", "junit"]),
            assetCount: 2,
            staticReferences: expect.arrayContaining([
                expect.objectContaining({kind: "module-import", target: "src/example"}),
                expect.objectContaining({kind: "java-import", target: "org.junit.jupiter.api.Test"}),
            ]),
        });
    });
});
