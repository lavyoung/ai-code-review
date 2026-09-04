import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {TestInventorySummary} from "../../domain/impact/model/impact-package.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";
import type {TestInventoryPort} from "../../application/review/ports/test-inventory-port.js";

const execFileAsync = promisify(execFile);
const MAX_TEST_FILES = 64;
const testPathPattern = /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu;
const javaTestPathPattern = /(?:^|\/)src\/test\/java\/.+\.java$/iu;

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
            }
        }
        return {
            status: candidatePaths.length > MAX_TEST_FILES ? "partial" : "available",
            frameworks: [...frameworks],
            assetCount,
        };
    }
}
