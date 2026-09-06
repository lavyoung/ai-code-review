import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {
    CommittedRevisionSourcePort,
    CommittedRevisionSourceSnapshot,
    CommittedSourceFile,
} from "../../application/review/ports/committed-revision-source-port.js";
import type {RawCodeChange} from "../../domain/review/model/code-change.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_FILES = 100;
const MAX_FILE_CHARS = 256 * 1024;
const MAX_TOTAL_CHARS = 2 * 1024 * 1024;
const READ_CONCURRENCY = 4;

export interface RevisionSourceGitRunner {
    run(arguments_: readonly string[], signal: AbortSignal): Promise<string>;
}

const createRunner = (workingDirectory: string): RevisionSourceGitRunner => ({
    async run(arguments_, signal) {
        const {stdout} = await execFileAsync("git", [...arguments_], {
            cwd: workingDirectory,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
            signal,
        });
        return String(stdout);
    },
});

const languageOf = (path: string): CommittedSourceFile["language"] | undefined =>
    /\.(?:[cm]?[jt]sx?)$/iu.test(path) ? "typescript" : /\.java$/iu.test(path) ? "java" : undefined;

const resolveRevision = async (
    runner: RevisionSourceGitRunner,
    range: NonNullable<RawCodeChange["revisionRange"]>,
    revision: "base" | "head",
    signal: AbortSignal,
): Promise<string> => {
    const resolveCommit = async (reference: string): Promise<string> => (await runner.run([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${reference}^{commit}`,
    ], signal)).trim();
    if (revision === "head") {
        return resolveCommit(range.headRef);
    }
    if (range.comparison === "two-dot") {
        return resolveCommit(range.baseRef);
    }
    const [baseCommit, headCommit] = await Promise.all([
        resolveCommit(range.baseRef),
        resolveCommit(range.headRef),
    ]);
    return (await runner.run(["merge-base", baseCommit, headCommit], signal)).trim();
};

/**
 * 从 Git 对象数据库读取受限的已提交源码快照，不接触工作区文件。
 */
export class GitCommittedRevisionSource implements CommittedRevisionSourcePort {
    private readonly runner: RevisionSourceGitRunner;

    public constructor(workingDirectory: string, runner: RevisionSourceGitRunner = createRunner(workingDirectory)) {
        this.runner = runner;
    }

    public async read(
        range: NonNullable<RawCodeChange["revisionRange"]>,
        revision: "base" | "head",
        signal: AbortSignal,
    ): Promise<CommittedRevisionSourceSnapshot> {
        try {
            const resolvedRevision = await resolveRevision(this.runner, range, revision, signal);
            if (resolvedRevision === "") {
                return {status: "unavailable", files: []};
            }
            const listed = await this.runner.run(["ls-tree", "-r", "-z", "--name-only", resolvedRevision, "--"], signal);
            const supportedPaths = listed.split("\0")
                .filter((path) => path !== "")
                .filter((path) => languageOf(path) !== undefined || path === "tsconfig.json")
                .filter((path) => !isSensitiveFile({path, status: "modified"}));
            const selectedPaths = supportedPaths.slice(0, MAX_SOURCE_FILES);
            const loaded = await this.readFiles(resolvedRevision, selectedPaths, signal);
            const files: CommittedSourceFile[] = [];
            let typeScriptConfiguration: CommittedRevisionSourceSnapshot["typeScriptConfiguration"];
            let totalChars = 0;
            let partial = supportedPaths.length > selectedPaths.length || loaded.some((entry) => entry.content === undefined);
            for (const entry of loaded) {
                const language = languageOf(entry.path);
                if (entry.content === undefined || entry.content.length > MAX_FILE_CHARS) {
                    partial = true;
                    continue;
                }
                if (totalChars + entry.content.length > MAX_TOTAL_CHARS) {
                    partial = true;
                    break;
                }
                totalChars += entry.content.length;
                if (entry.path === "tsconfig.json") {
                    typeScriptConfiguration = {path: "tsconfig.json", content: entry.content};
                    continue;
                }
                if (language === undefined) {
                    partial = true;
                    continue;
                }
                files.push({path: entry.path, language, content: entry.content});
            }
            return {
                status: partial ? "partial" : "available",
                files,
                ...(typeScriptConfiguration === undefined ? {} : {typeScriptConfiguration}),
            };
        } catch {
            return {status: "unavailable", files: []};
        }
    }

    private async readFiles(
        revision: string,
        paths: readonly string[],
        signal: AbortSignal,
    ): Promise<{path: string; content?: string}[]> {
        const results: {path: string; content?: string}[] = new Array(paths.length);
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < paths.length) {
                const index = nextIndex;
                nextIndex += 1;
                const path = paths[index];
                if (path === undefined) {
                    continue;
                }
                try {
                    results[index] = {
                        path,
                        content: await this.runner.run(["show", "--no-textconv", `${revision}:${path}`], signal),
                    };
                } catch {
                    results[index] = {path};
                }
            }
        };
        await Promise.all(Array.from({length: Math.min(READ_CONCURRENCY, paths.length)}, worker));
        return results.filter((entry) => entry !== undefined);
    }
}
