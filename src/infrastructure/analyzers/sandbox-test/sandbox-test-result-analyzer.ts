import {execFile} from "node:child_process";
import {createHmac, timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";
import {promisify} from "node:util";
import {z} from "zod";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {ReviewCandidate} from "../../../domain/review/model/review-candidate.js";
import {findAddedLineEvidence} from "../../../domain/review/policy/find-added-line-evidence.js";
import type {
    AnalysisRequest,
    AnalyzerIdentity,
    ReviewAnalyzer,
} from "../../../application/review/ports/review-analyzer-port.js";

const execFileAsync = promisify(execFile);
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

const sandboxFailureSchema = z.object({
    file: z.string().trim().min(1),
    line: z.number().int().positive(),
    failureCode: z.string().trim().min(1).max(64),
}).strict();

const sandboxTestPayloadSchema = z.object({
    schemaVersion: z.literal("v1"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    failures: z.array(sandboxFailureSchema).max(100),
}).strict();

const signedSandboxTestReportSchema = z.object({
    payload: sandboxTestPayloadSchema,
    signature: z.string().regex(/^v1=[a-f0-9]{64}$/),
}).strict();

type SandboxTestPayload = z.infer<typeof sandboxTestPayloadSchema>;

/** 受控测试运行器产出的签名结果文件配置；其路径与签名密钥都禁止记录。 */
export interface SandboxedTestResultAnalyzerConfiguration {
    reportPath: string;
    signingSecret: string;
}

/** 抽象当前已检出提交，避免测试结果与待评审提交不一致。 */
export interface CommittedRevisionProvider {
    resolve(signal: AbortSignal): Promise<string>;
}

const createGitRevisionProvider = (workingDirectory: string): CommittedRevisionProvider => ({
    async resolve(signal: AbortSignal): Promise<string> {
        const {stdout} = await execFileAsync("git", ["rev-parse", "HEAD"], {
            cwd: workingDirectory,
            encoding: "utf8",
            signal,
        });
        const revision = stdout.trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(revision)) {
            throw new Error("Committed test result revision was invalid.");
        }
        return revision;
    },
});

const hasValidSignature = (payload: SandboxTestPayload, signature: string, secret: string): boolean => {
    const expected = Buffer.from(`v1=${createHmac("sha256", secret)
        .update(JSON.stringify(payload), "utf8")
        .digest("hex")}`, "utf8");
    const received = Buffer.from(signature, "utf8");

    return expected.length === received.length && timingSafeEqual(expected, received);
};

/**
 * 读取由外部受控沙箱执行器签名的测试失败结果。
 *
 * 本适配器不运行仓库命令；它只接受与当前提交匹配、签名有效且能锚定到新增行的
 * 失败事件，因此宿主机不需要假装拥有网络或文件系统隔离能力。
 */
export class SandboxedTestResultAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {
        kind: "test",
        id: "sandbox-test",
        verificationEligible: true,
    };

    public readonly capabilities = {
        inputAccess: "sanitized-model-input" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    };

    public constructor(
        private readonly configuration: SandboxedTestResultAnalyzerConfiguration,
        private readonly revisionProvider: CommittedRevisionProvider,
    ) {
    }

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        const [report, currentRevision] = await Promise.all([
            this.readVerifiedReport(),
            this.revisionProvider.resolve(request.signal),
        ]);
        if (report.sourceRevision !== currentRevision) {
            throw new Error("Sandbox test result revision did not match the committed review revision.");
        }

        const findings = report.failures.flatMap((failure): ReviewCandidate[] => {
            const located = findAddedLineEvidence(request.codeChange, failure.file, failure.line);
            if (located === undefined) {
                return [];
            }
            return [{
                severity: "high",
                title: "Sandboxed test failure",
                description: "A signed sandboxed test failed on a changed added line.",
                suggestion: "Reproduce the failing test in the sandbox and correct the changed behavior.",
                category: "test",
                file: failure.file,
                line: failure.line,
                chunkId: located.chunk.id,
                evidence: located.evidence,
            }];
        });

        return {
            summary: `Sandboxed test results contained ${report.failures.length} failure(s); ${findings.length} mapped to changed added lines.`,
            findings,
        };
    }

    private async readVerifiedReport(): Promise<SandboxTestPayload> {
        const content = await readFile(this.configuration.reportPath, "utf8");
        if (Buffer.byteLength(content, "utf8") > MAX_REPORT_BYTES) {
            throw new Error("Sandbox test result report exceeded the allowed size.");
        }
        const report = signedSandboxTestReportSchema.parse(JSON.parse(content));
        if (!hasValidSignature(report.payload, report.signature, this.configuration.signingSecret)) {
            throw new Error("Sandbox test result signature was invalid.");
        }
        return report.payload;
    }
}

/** 为唯一的装配边界创建当前提交解析器。 */
export const createCommittedRevisionProvider = (workingDirectory: string): CommittedRevisionProvider =>
    createGitRevisionProvider(workingDirectory);
