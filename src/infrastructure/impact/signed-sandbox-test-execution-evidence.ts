import type {TestExecutionEvidencePort} from "../../application/review/ports/test-execution-evidence-port.js";
import {
    SignedSandboxTestReportReader,
    type SignedSandboxTestReportConfiguration,
} from "../analyzers/sandbox-test/signed-sandbox-test-report.js";
import type {CommittedRevisionProvider} from "../scm/git/committed-revision-provider.js";
import {createOpaqueTestAssetId} from "./test-asset-identity.js";

/** 将受控沙箱中已通过的测试文件投影成不透明测试资产证明。 */
export class SignedSandboxTestExecutionEvidence implements TestExecutionEvidencePort {
    private readonly reader: SignedSandboxTestReportReader;

    public constructor(
        configuration: SignedSandboxTestReportConfiguration,
        revisionProvider: CommittedRevisionProvider,
    ) {
        this.reader = new SignedSandboxTestReportReader(configuration, revisionProvider);
    }

    public async readPassedTestIds(signal: AbortSignal): Promise<readonly string[]> {
        const report = await this.reader.read(signal);

        return [...new Set(report.passedTests.map((test) => createOpaqueTestAssetId(test.file)))];
    }
}
