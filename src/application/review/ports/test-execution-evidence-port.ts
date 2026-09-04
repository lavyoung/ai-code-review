/** 只读取已验签、与当前提交匹配的受控测试通过证明。 */
export interface TestExecutionEvidencePort {
    readPassedTestIds(signal: AbortSignal): Promise<readonly string[]>;
}
