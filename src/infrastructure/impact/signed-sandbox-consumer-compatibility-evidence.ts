import type {
    ConsumerCompatibilityClaim,
    ConsumerCompatibilityEvidencePort,
} from "../../application/review/ports/consumer-compatibility-evidence-port.js";
import {
    SignedSandboxTestReportReader,
    type SignedSandboxTestReportConfiguration,
} from "../analyzers/sandbox-test/signed-sandbox-test-report.js";
import type {CommittedRevisionProvider} from "../scm/git/committed-revision-provider.js";

/**
 * 将已验签、当前 revision 的受控沙箱报告投影为消费者兼容性声明。
 *
 * 该适配器不信任声明本身的业务含义；调用方必须再匹配已审核消费者目录与当前契约关系。
 */
export class SignedSandboxConsumerCompatibilityEvidence implements ConsumerCompatibilityEvidencePort {
    private readonly reportReader: SignedSandboxTestReportReader;

    public constructor(
        configuration: SignedSandboxTestReportConfiguration,
        revisionProvider: CommittedRevisionProvider,
    ) {
        this.reportReader = new SignedSandboxTestReportReader(configuration, revisionProvider);
    }

    public async readValidatedConsumers(signal: AbortSignal): Promise<readonly ConsumerCompatibilityClaim[]> {
        const report = await this.reportReader.read(signal);

        return report.validatedConsumers.map((consumer) => ({
            consumerId: consumer.id,
            consumerSourceRevision: consumer.sourceRevision,
            contractPath: consumer.contractFile,
        }));
    }
}
