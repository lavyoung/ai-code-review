import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiffProvider, DiffRange } from "../../../application/review/ports/diff-provider.js";
import type {
    ChangedFile,
    ChangeStatus,
    RawCodeChange,
    RawFileChange,
} from "../../../domain/review/model/code-change.js";

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

/** 按 Git 文件段拆分原始 diff；结果仅保留在本地安全投影之前。 */
const splitRawFileChanges = (
    diff: string,
    files: readonly ChangedFile[],
): RawFileChange[] => {
    const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
    const sectionByPath = new Map<string, string>();

    for (const section of sections) {
        const path = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1]
            ?? /^--- a\/(.+)$/m.exec(section)?.[1];
        if (path !== undefined) {
            sectionByPath.set(path, section);
        }
    }

    return files.map((file) => ({
        file,
        diff: sectionByPath.get(file.path) ?? "",
    }));
};

/**
 * 基于本地 Git 仓库生成仅限本地使用的原始已提交变更的适配器。
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
     * 获取范围内的原始变更。调用方必须立即执行安全投影，不得输出结果。
     */
    public async getRawCodeChange(range: DiffRange): Promise<RawCodeChange> {
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
        const diff = allFiles.length === 0
            ? ""
            : await this.runner.run([
                "diff",
                "--no-ext-diff",
                "--binary",
                rangeNotation,
                "--",
                ...allFiles.map((file) => file.path),
            ]);

        return {
            fileChanges: splitRawFileChanges(diff, allFiles),
        };
    }
}
