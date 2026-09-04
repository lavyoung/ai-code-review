/** 只读取已验签、当前提交上的受控契约验证证明。 */
export interface ContractValidationEvidencePort {
    readValidatedContractPaths(signal: AbortSignal): Promise<readonly string[]>;
}
