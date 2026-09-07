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
        await writeFile(
            join(directory, "tests", "example.test.ts"),
            "import {it} from \"vitest\";\nimport {example, unused} from \"../src/example.js\";\n"
                + "import {token} from \"../src/secrets/token.js\";\n"
                + "const shadowed = (unused: () => void) => unused();\nconst neverCalled = () => unused();\n"
                + "it(\"works\", () => { example(); token(); });\n",
            "utf8",
        );
        await writeFile(
            join(directory, "tests", "service.spec.ts"),
            "import {test} from \"@jest/globals\";\nimport * as service from \"../src/service.js\";\n"
                + "test(\"runs\", () => service.run());\n",
            "utf8",
        );
        await writeFile(
            join(directory, "src", "test", "java", "example", "ExampleTest.java"),
            "import org.junit.jupiter.api.Test;\nimport com.example.Service;\nimport com.example.secrets.Token;\n"
                + "class ExampleTest { void helper() { Service.hidden(); } "
                + "@Test void works() { Service.execute(); Token.read(); } }\n",
            "utf8",
        );
        await writeFile(join(directory, "tests", "secret.env"), "API_KEY=must-not-be-read", "utf8");
        await git(directory, "add", ".");
        await git(directory, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");

        const inventory = await new CommittedTestInventory(directory).discover(AbortSignal.timeout(5_000));
        expect(inventory).toEqual({
            status: "available",
            sourceRevision: expect.stringMatching(/^[a-f0-9]{40}$/u),
            frameworks: expect.arrayContaining(["vitest", "jest", "junit"]),
            assetCount: 3,
            staticReferences: expect.arrayContaining([
                expect.objectContaining({
                    kind: "module-import",
                    target: "src/example",
                    framework: "vitest",
                    association: "direct-static-import",
                }),
                expect.objectContaining({
                    kind: "typescript-symbol-call",
                    target: "src.example.example",
                    association: "direct-symbol-call",
                }),
                expect.objectContaining({
                    kind: "typescript-symbol-call",
                    target: "src.service.run",
                    framework: "jest",
                    association: "direct-symbol-call",
                }),
                expect.objectContaining({kind: "java-import", target: "org.junit.jupiter.api.Test"}),
                expect.objectContaining({
                    kind: "java-symbol-call",
                    target: "com.example.Service#execute",
                    association: "direct-symbol-call",
                }),
            ]),
        });
        expect(inventory.staticReferences).not.toEqual(expect.arrayContaining([
            expect.objectContaining({kind: "typescript-symbol-call", target: "src.example.unused"}),
        ]));
        expect(inventory.staticReferences).not.toEqual(expect.arrayContaining([
            expect.objectContaining({kind: "java-symbol-call", target: "com.example.Service#hidden"}),
        ]));
        expect(inventory.staticReferences.some((reference) => reference.target.includes("secrets"))).toBe(false);
    }, 15_000);
});
