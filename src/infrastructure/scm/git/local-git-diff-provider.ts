import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { DiffProvider, DiffRange } from "../../../application/review/ports/diff-provider.js";
import type {
    ChangedFile,
    ChangeStatus,
    CodeChange,
    DiffChunk,
    SourceRange,
} from "../../../domain/review/model/code-change.js";
import {
    isSensitiveFile,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";

const execFileAsync = promisify(execFile);

/**
 * 执行 Git 命令的基础设施协作者，便于隔离系统进程并进行单元测试。
 */
export interface GitCommandRunner {
    /**
     * 执行不经 Shell 解释的 Git 参数列表。
     */
    run(arguments_: readonly string[]): Promise<string>;
}

const createGitCommandRunner = (cwd: string): GitCommandRunner => ({
    async run(arguments_: readonly string[]): Promise<string> {
        const { stdout } = await execFileAsync("git", arguments_, {
            cwd,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
        });

        return String(stdout);
    },
});

const toRangeNotation = (range: DiffRange): string =>
    `${range.baseRef}${range.comparison === "two-dot" ? ".." : "..."}${range.headRef}`;

const toChangeStatus = (value: string): ChangeStatus => {
    switch (value.charAt(0)) {
        case "A":
            return "added";
        case "M":
        case "T":
            return "modified";
        case "D":
            return "deleted";
        case "R":
            return "renamed";
        default:
            throw new Error("Unsupported Git file status.");
    }
};

const parseChangedFiles = (output: string): ChangedFile[] => {
    const values = output.split("\0");
    const files: ChangedFile[] = [];
    let index = 0;

    while (index < values.length) {
        const rawStatus = values[index++];
        if (rawStatus === undefined || rawStatus === "") {
            continue;
        }

        const status = toChangeStatus(rawStatus);
        const firstPath = values[index++];
        if (firstPath === undefined || firstPath === "") {
            throw new Error("Malformed Git name-status output.");
        }

        if (status === "renamed") {
            const renamedPath = values[index++];
            if (renamedPath === undefined || renamedPath === "") {
                throw new Error("Malformed Git rename output.");
            }

            files.push({
                path: renamedPath,
                status,
                previousPath: firstPath,
            });
            continue;
        }

        files.push({ path: firstPath, status });
    }

    return files;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const toSourceRange = (start: string, count: string | undefined): SourceRange | undefined => {
    const numericStart = Number(start);
    const numericCount = count === undefined ? 1 : Number(count);

    if (numericCount === 0) {
        return undefined;
    }

    return {
        startLine: numericStart,
        endLine: numericStart + numericCount - 1,
    };
};

const createChunkId = (
    rangeNotation: string,
    path: string,
    oldRange: SourceRange | undefined,
    newRange: SourceRange | undefined,
    content: string,
): string => createHash("sha256")
    .update(JSON.stringify({ rangeNotation, path, oldRange, newRange, content }))
    .digest("hex")
    .slice(0, 24);

/**
 * 将已脱敏的 unified diff 切分为可被模型精确引用的 hunk。
 *
 * Git 的文件头只用于选择 hunk 所属安全路径；模型只会获得 hunk 内容和
 * 稳定标识，不能借此取得被敏感策略排除的文件。
 */
const createDiffChunks = (diff: string, rangeNotation: string): DiffChunk[] => {
    const chunks: DiffChunk[] = [];
    let path: string | undefined;
    let oldPath: string | undefined;
    let oldRange: SourceRange | undefined;
    let newRange: SourceRange | undefined;
    let lines: string[] = [];

    const flush = (): void => {
        if (path === undefined || lines.length === 0) {
            lines = [];
            return;
        }

        const content = lines.join("\n");
        chunks.push({
            id: createChunkId(rangeNotation, path, oldRange, newRange, content),
            path,
            ...(newRange === undefined ? {} : { newRange }),
            ...(oldRange === undefined ? {} : { oldRange }),
            content,
        });
        lines = [];
    };

    for (const line of diff.split("\n")) {
        if (line.startsWith("diff --git ")) {
            flush();
            path = undefined;
            oldPath = undefined;
            oldRange = undefined;
            newRange = undefined;
            continue;
        }

        if (line.startsWith("--- a/")) {
            oldPath = line.slice("--- a/".length);
            continue;
        }

        if (line.startsWith("+++ b/")) {
            path = line.slice("+++ b/".length);
            continue;
        }

        if (line === "+++ /dev/null") {
            path = oldPath;
            continue;
        }

        const hunk = HUNK_HEADER.exec(line);
        if (hunk !== null) {
            flush();
            oldRange = toSourceRange(hunk[1] ?? "0", hunk[2]);
            newRange = toSourceRange(hunk[3] ?? "0", hunk[4]);
            lines = [line];
            continue;
        }

        if (lines.length > 0) {
            lines.push(line);
        }
    }

    flush();
    return chunks;
};

/**
 * 基于本地 Git 仓库生成安全代码变更的适配器。
 */
export class LocalGitDiffProvider implements DiffProvider {
    private readonly runner: GitCommandRunner;

    /**
     * @param cwd 本地 Git 仓库工作目录。
     * @param runner Git 命令执行器；默认使用系统 Git。
     */
    public constructor(cwd: string, runner: GitCommandRunner = createGitCommandRunner(cwd)) {
        this.runner = runner;
    }

    /**
     * 获取范围内的变更，并在返回前排除敏感文件和脱敏文本。
     */
    public async getCodeChange(range: DiffRange): Promise<CodeChange> {
        const rangeNotation = toRangeNotation(range);
        const nameStatus = await this.runner.run([
            "diff",
            "--name-status",
            "--find-renames",
            "-z",
            rangeNotation,
            "--",
        ]);
        const allFiles = parseChangedFiles(nameStatus);
        const files = allFiles.filter((file) => !isSensitiveFile(file));
        const diff = files.length === 0
            ? ""
            : await this.runner.run([
                "diff",
                "--no-ext-diff",
                "--binary",
                rangeNotation,
                "--",
                ...files.map((file) => file.path),
            ]);
        const redactedDiff = redactSensitiveValues(diff);

        return {
            diff: redactedDiff.content,
            files,
            chunks: createDiffChunks(redactedDiff.content, rangeNotation),
            excludedFileCount: allFiles.length - files.length,
            redactedValueCount: redactedDiff.redactedValueCount,
        };
    }
}
