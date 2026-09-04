import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {CommittedFileReader} from "../../../application/review/ports/committed-file-reader.js";

const execFileAsync = promisify(execFile);

/** 以 Git `HEAD` 而非文件系统读取工作流，避免未提交内容进入评审。 */
export class LocalCommittedFileReader implements CommittedFileReader {
    public constructor(private readonly workingDirectory: string) {}

    public async readHeadFile(path: string, signal: AbortSignal): Promise<string | undefined> {
        try {
            const {stdout} = await execFileAsync("git", ["show", "--no-textconv", `HEAD:${path}`], {
                cwd: this.workingDirectory,
                encoding: "utf8",
                maxBuffer: 256 * 1024,
                signal,
            });
            return stdout;
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === 128) {
                return undefined;
            }
            throw error;
        }
    }
}
