/** 只读取当前检出提交中的文件，禁止退回到未提交工作区。 */
export interface CommittedFileReader {
    readHeadFile(path: string, signal: AbortSignal): Promise<string | undefined>;
}
