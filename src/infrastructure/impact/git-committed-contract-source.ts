import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {
    CommittedContractDocument,
    CommittedContractSnapshot,
    CommittedContractSourcePort,
} from "../../application/review/ports/committed-contract-source-port.js";
import type {RawCodeChange} from "../../domain/review/model/code-change.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";

const execFileAsync = promisify(execFile);
const MAX_CONTRACT_FILES = 16;
const MAX_CONTRACT_CHARS = 512 * 1024;
const MAX_TOTAL_CONTRACT_CHARS = 2 * 1024 * 1024;

export interface ContractSourceGitRunner {
    run(arguments_: readonly string[], signal: AbortSignal): Promise<string>;
}

const createRunner = (workingDirectory: string): ContractSourceGitRunner => ({
    async run(arguments_, signal) {
        const {stdout} = await execFileAsync("git", [...arguments_], {
            cwd: workingDirectory,
            encoding: "utf8",
            maxBuffer: MAX_TOTAL_CONTRACT_CHARS + MAX_CONTRACT_CHARS,
            signal,
        });
        return String(stdout);
    },
});

const isSafeContractPath = (path: string): boolean => path !== ""
    && !path.includes("\\")
    && !path.startsWith("/")
    && !path.split("/").includes("..")
    && !isSensitiveFile({path, status: "modified"});

const resolveRevision = async (
    runner: ContractSourceGitRunner,
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

const isMissingGitObject = (error: unknown): boolean => typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === 128;

/** 从 Git 对象数据库读取有限数量的契约文件，不解析正文或访问工作区。 */
export class GitCommittedContractSource implements CommittedContractSourcePort {
    private readonly runner: ContractSourceGitRunner;

    public constructor(workingDirectory: string, runner: ContractSourceGitRunner = createRunner(workingDirectory)) {
        this.runner = runner;
    }

    public async read(
        range: NonNullable<RawCodeChange["revisionRange"]>,
        revision: "base" | "head",
        paths: readonly string[],
        signal: AbortSignal,
    ): Promise<CommittedContractSnapshot> {
        const uniquePaths = [...new Set(paths)];
        if (uniquePaths.some((path) => !isSafeContractPath(path))) {
            return {status: "unavailable", documents: []};
        }
        try {
            const resolvedRevision = await resolveRevision(this.runner, range, revision, signal);
            if (resolvedRevision === "") {
                return {status: "unavailable", documents: []};
            }
            const selectedPaths = uniquePaths.slice(0, MAX_CONTRACT_FILES);
            const loaded = await Promise.all(selectedPaths.map(async (path): Promise<CommittedContractDocument | undefined> => {
                try {
                    const content = await this.runner.run(["show", "--no-textconv", `${resolvedRevision}:${path}`], signal);
                    return {path, content};
                } catch (error) {
                    if (isMissingGitObject(error)) {
                        return undefined;
                    }
                    throw error;
                }
            }));
            const documents: CommittedContractDocument[] = [];
            let totalChars = 0;
            let partial = uniquePaths.length > selectedPaths.length;
            for (const document of loaded) {
                if (document === undefined) {
                    continue;
                }
                if (document.content.length > MAX_CONTRACT_CHARS
                    || totalChars + document.content.length > MAX_TOTAL_CONTRACT_CHARS) {
                    partial = true;
                    continue;
                }
                totalChars += document.content.length;
                documents.push(document);
            }
            return {status: partial ? "partial" : "available", documents};
        } catch {
            return {status: "unavailable", documents: []};
        }
    }
}
