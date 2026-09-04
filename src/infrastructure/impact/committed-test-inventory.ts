import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {posix} from "node:path";
import {promisify} from "node:util";
import type {StaticTestReference, TestInventorySummary} from "../../domain/impact/model/impact-package.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";
import type {TestInventoryPort} from "../../application/review/ports/test-inventory-port.js";
import {createOpaqueTestAssetId} from "./test-asset-identity.js";

const execFileAsync = promisify(execFile);
const MAX_TEST_FILES = 64;
const testPathPattern = /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu;
const javaTestPathPattern = /(?:^|\/)src\/test\/java\/.+\.java$/iu;
const typeScriptImport = /(?:import|export)\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gu;
const commonJsRequire = /require\(\s*["']([^"']+)["']\s*\)/gu;
const javaImport = /^\s*import\s+(?:static\s+)?([A-Za-z_$][\w.$]*);/gmu;

const classifyFramework = (content: string): "vitest" | "jest" | "junit" | undefined => {
    if (/\b(?:from\s+["']vitest["']|require\(\s*["']vitest["']\s*\))/u.test(content)) {
        return "vitest";
    }
    if (/\b(?:from\s+["'](?:@jest\/globals|jest)["']|require\(\s*["'](?:@jest\/globals|jest)["']\s*\))/u.test(content)) {
        return "jest";
    }
    if (/\bimport\s+org\.junit(?:\.jupiter)?\.|\borg\.junit\.jupiter\.api\.Test\b/u.test(content)) {
        return "junit";
    }
    return undefined;
};

const toOpaqueId = (prefix: string, value: string): string =>
    `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

const normalizeTypeScriptTarget = (testPath: string, target: string): string | undefined => {
    if (!target.startsWith(".")) {
        return undefined;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(testPath), target));

    return resolved.replace(/\.(?:[cm]?[jt]sx?)$/iu, "");
};

const findStaticReferences = (
    path: string,
    content: string,
    framework: "vitest" | "jest" | "junit",
): readonly StaticTestReference[] => {
    const testId = createOpaqueTestAssetId(path);
    const targets = new Set<string>();
    const kind = framework === "junit" ? "java-import" as const : "module-import" as const;
    if (kind === "java-import") {
        for (const match of content.matchAll(javaImport)) {
            targets.add(match[1]!);
        }
    } else {
        for (const pattern of [typeScriptImport, commonJsRequire]) {
            for (const match of content.matchAll(pattern)) {
                const target = normalizeTypeScriptTarget(path, match[1]!);
                if (target !== undefined) {
                    targets.add(target);
                }
            }
        }
    }

    return [...targets].map((target) => ({
        id: toOpaqueId("test-reference", `${testId}:${kind}:${target}`),
        testId,
        target,
        kind,
    }));
};

/**
 * 仅读取 HEAD 中受限数量的候选测试文件，生成无路径、无正文的框架与数量摘要。
 *
 * 这不是测试运行器；发现测试资产不等于证明其覆盖任意影响路径。
 */
export class CommittedTestInventory implements TestInventoryPort {
    public constructor(private readonly workingDirectory: string) {}

    public async discover(signal: AbortSignal): Promise<TestInventorySummary> {
        const {stdout} = await execFileAsync("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"], {
            cwd: this.workingDirectory,
            encoding: "utf8",
            maxBuffer: 256 * 1024,
            signal,
        });
        const candidatePaths = stdout.split("\0")
            .filter((path) => path.length > 0)
            .filter((path) => !isSensitiveFile({path, status: "modified"}))
            .filter((path) => testPathPattern.test(path) || javaTestPathPattern.test(path));
        const paths = candidatePaths.slice(0, MAX_TEST_FILES);
        const frameworks = new Set<"vitest" | "jest" | "junit">();
        const references: StaticTestReference[] = [];
        let assetCount = 0;
        for (const path of paths) {
            if (signal.aborted) {
                throw signal.reason;
            }
            const {stdout: content} = await execFileAsync("git", ["show", "--no-textconv", `HEAD:${path}`], {
                cwd: this.workingDirectory,
                encoding: "utf8",
                maxBuffer: 256 * 1024,
                signal,
            });
            const framework = classifyFramework(content);
            if (framework !== undefined) {
                frameworks.add(framework);
                assetCount += 1;
                references.push(...findStaticReferences(path, content, framework));
            }
        }
        return {
            status: candidatePaths.length > MAX_TEST_FILES ? "partial" : "available",
            frameworks: [...frameworks],
            assetCount,
            staticReferences: references,
        };
    }
}
