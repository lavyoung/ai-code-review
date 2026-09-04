import {createHmac, timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import type {CommittedRevisionProvider} from "../../scm/git/committed-revision-provider.js";

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

const sandboxFailureSchema = z.object({
    file: z.string().trim().min(1),
    line: z.number().int().positive(),
    failureCode: z.string().trim().min(1).max(64),
}).strict();

const passedTestSchema = z.object({
    file: z.string().trim().min(1).max(1_024),
}).strict();

const sandboxTestPayloadSchema = z.object({
    schemaVersion: z.literal("v1"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    failures: z.array(sandboxFailureSchema).max(100),
    /** 旧版报告省略该字段时不产生通过证明，以保持安全的向后兼容。 */
    passedTests: z.array(passedTestSchema).max(1_000).optional(),
}).strict();

const signedSandboxTestReportSchema = z.object({
    payload: sandboxTestPayloadSchema,
    signature: z.string().regex(/^v1=[a-f0-9]{64}$/),
}).strict();

type SignedSandboxTestPayload = z.infer<typeof sandboxTestPayloadSchema>;

/** 验签和 revision 校验后的安全报告投影。 */
export interface SandboxTestPayload extends Omit<SignedSandboxTestPayload, "passedTests"> {
    passedTests: readonly {file: string}[];
}

/** 受控沙箱报告的敏感配置；不得输出路径、签名或原文。 */
export interface SignedSandboxTestReportConfiguration {
    reportPath: string;
    signingSecret: string;
}

const hasValidSignature = (payload: SignedSandboxTestPayload, signature: string, secret: string): boolean => {
    const expected = Buffer.from(`v1=${createHmac("sha256", secret)
        .update(JSON.stringify(payload), "utf8")
        .digest("hex")}`, "utf8");
    const received = Buffer.from(signature, "utf8");

    return expected.length === received.length && timingSafeEqual(expected, received);
};

/**
 * 读取并验证外部沙箱的结果证明；宿主程序绝不执行仓库命令。
 */
export class SignedSandboxTestReportReader {
    public constructor(
        private readonly configuration: SignedSandboxTestReportConfiguration,
        private readonly revisionProvider: CommittedRevisionProvider,
    ) {}

    public async read(signal: AbortSignal): Promise<SandboxTestPayload> {
        if (signal.aborted) {
            throw signal.reason;
        }
        const [content, currentRevision] = await Promise.all([
            readFile(this.configuration.reportPath, "utf8"),
            this.revisionProvider.resolve(signal),
        ]);
        if (Buffer.byteLength(content, "utf8") > MAX_REPORT_BYTES) {
            throw new Error("Sandbox test result report exceeded the allowed size.");
        }
        const report = signedSandboxTestReportSchema.parse(JSON.parse(content));
        if (!hasValidSignature(report.payload, report.signature, this.configuration.signingSecret)) {
            throw new Error("Sandbox test result signature was invalid.");
        }
        if (report.payload.sourceRevision !== currentRevision) {
            throw new Error("Sandbox test result revision did not match the committed review revision.");
        }
        return {...report.payload, passedTests: report.payload.passedTests ?? []};
    }
}
