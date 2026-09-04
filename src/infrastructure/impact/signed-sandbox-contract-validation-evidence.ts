import type {ContractValidationEvidencePort} from "../../application/review/ports/contract-validation-evidence-port.js";
import {
    SignedSandboxTestReportReader,
    type SignedSandboxTestReportConfiguration,
} from "../analyzers/sandbox-test/signed-sandbox-test-report.js";
import type {CommittedRevisionProvider} from "../scm/git/committed-revision-provider.js";

/** 从受控沙箱报告读取当前提交已验证的契约路径；路径绝不离开本地编排边界。 */
export class SignedSandboxContractValidationEvidence implements ContractValidationEvidencePort {
    private readonly reader: SignedSandboxTestReportReader;

    public constructor(
        configuration: SignedSandboxTestReportConfiguration,
        revisionProvider: CommittedRevisionProvider,
    ) {
        this.reader = new SignedSandboxTestReportReader(configuration, revisionProvider);
    }

    public async readValidatedContractPaths(signal: AbortSignal): Promise<readonly string[]> {
        const report = await this.reader.read(signal);

        return [...new Set(report.validatedContracts.map((contract) => contract.file))];
    }
}
