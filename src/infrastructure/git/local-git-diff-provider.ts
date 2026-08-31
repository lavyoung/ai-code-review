import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiffProvider, DiffRange } from "../../application/ports/diff-provider.js";
import type {
    ChangedFile,
    ChangeStatus,
    CodeChange,
} from "../../domain/review/code-change.js";

const execFileAsync = promisify(execFile);

export interface GitCommandRunner {
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

            files.push({ path: renamedPath, status });
            continue;
        }

        files.push({ path: firstPath, status });
    }

    return files;
};

export class LocalGitDiffProvider implements DiffProvider {
    private readonly runner: GitCommandRunner;

    public constructor(cwd: string, runner: GitCommandRunner = createGitCommandRunner(cwd)) {
        this.runner = runner;
    }

    public async getCodeChange(range: DiffRange): Promise<CodeChange> {
        const rangeNotation = toRangeNotation(range);
        const diff = await this.runner.run([
            "diff",
            "--no-ext-diff",
            "--binary",
            rangeNotation,
            "--",
        ]);
        const nameStatus = await this.runner.run([
            "diff",
            "--name-status",
            "--find-renames",
            "-z",
            rangeNotation,
            "--",
        ]);

        return {
            diff,
            files: parseChangedFiles(nameStatus),
        };
    }
}
