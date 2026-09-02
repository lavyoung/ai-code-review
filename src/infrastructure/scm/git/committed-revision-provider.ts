import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

/** 提供当前已检出提交，确保外部受控产物与待评审 Git 范围一致。 */
export interface CommittedRevisionProvider {
    resolve(signal: AbortSignal): Promise<string>;
}

/** 从当前工作区读取 HEAD；只返回合法的完整小写提交 SHA。 */
export const createCommittedRevisionProvider = (
    workingDirectory: string,
): CommittedRevisionProvider => ({
    async resolve(signal: AbortSignal): Promise<string> {
        const {stdout} = await execFileAsync("git", ["rev-parse", "HEAD"], {
            cwd: workingDirectory,
            encoding: "utf8",
            signal,
        });
        const revision = stdout.trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(revision)) {
            throw new Error("Committed revision was invalid.");
        }
        return revision;
    },
});
