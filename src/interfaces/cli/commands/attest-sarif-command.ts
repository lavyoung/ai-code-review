import {readFile, writeFile} from "node:fs/promises";
import {Command} from "commander";
import {createCommittedRevisionProvider} from "../../../infrastructure/scm/git/committed-revision-provider.js";
import {createSarifAttestation} from "../../../infrastructure/analyzers/sarif/sarif-attestation.js";
import {CLI_EXIT_CODES} from "../exit-code.js";

interface AttestSarifCommandOptions {
    report: string;
    output: string;
}

const MAX_REPORT_BYTES = 10 * 1024 * 1024;

/**
 * 注册受控 SARIF 证明生成命令。
 *
 * 该命令必须只在可信 CI 任务中运行；它不会执行构建工具或读取未提交变更。
 */
export const configureAttestSarifCommand = (program: Command): void => {
    const attestSarifCommand = program
        .command("attest-sarif")
        .description("Create a signed, commit-bound SARIF attestation in a trusted CI job")
        .requiredOption("--report <path>", "SARIF 2.1.0 report path")
        .requiredOption("--output <path>", "Attestation output path")
        .action(async (options: AttestSarifCommandOptions) => {
            const signingPrivateKey = process.env.SARIF_SIGNING_PRIVATE_KEY?.trim();
            if (signingPrivateKey === undefined || signingPrivateKey === "") {
                console.error("Configuration error. SARIF_SIGNING_PRIVATE_KEY must be set.");
                process.exitCode = CLI_EXIT_CODES.INVALID_CONFIGURATION;
                return;
            }

            try {
                const [reportContent, sourceRevision] = await Promise.all([
                    readFile(options.report, "utf8"),
                    createCommittedRevisionProvider(process.cwd()).resolve(AbortSignal.timeout(10_000)),
                ]);
                if (Buffer.byteLength(reportContent, "utf8") > MAX_REPORT_BYTES) {
                    throw new Error("SARIF report exceeded the allowed size.");
                }
                const attestation = createSarifAttestation(reportContent, sourceRevision, signingPrivateKey);
                await writeFile(options.output, `${JSON.stringify(attestation)}\n`, "utf8");
                console.log("SARIF attestation: created");
                process.exitCode = CLI_EXIT_CODES.SUCCESS;
            } catch {
                console.error("SARIF attestation error. Check the report and committed Git revision.");
                process.exitCode = CLI_EXIT_CODES.REQUIRED_ANALYZER_FAILED;
            }
        });

    attestSarifCommand.exitOverride();
};
