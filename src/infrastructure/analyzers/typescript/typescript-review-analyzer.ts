import {execFile} from "node:child_process";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {ReviewCandidate} from "../../../domain/review/model/review-candidate.js";
import {findAddedLineEvidence} from "../../../domain/review/policy/find-added-line-evidence.js";
import {
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";
import type {
    AnalysisRequest,
    AnalyzerIdentity,
    ReviewAnalyzer,
} from "../../../application/review/ports/review-analyzer-port.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const typeScriptCommand = join(dirname(require.resolve("typescript")), "..", "bin", "tsc");
const diagnosticPattern = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.+)$/;

/** 一次 TypeScript 编译诊断命令的脱敏结果。 */
export interface TypeScriptCommandResult {
    output: string;
    exitCode: number;
}

/** 隔离子进程调用，便于在不运行真实编译器的情况下验证诊断映射。 */
export interface TypeScriptCommandRunner {
    run(workingDirectory: string, signal: AbortSignal): Promise<TypeScriptCommandResult>;
}

const defaultCommandRunner: TypeScriptCommandRunner = {
    async run(workingDirectory, signal): Promise<TypeScriptCommandResult> {
        try {
            const { stdout, stderr } = await execFileAsync(process.execPath, [
                typeScriptCommand,
                "--noEmit",
                "--pretty",
                "false",
                "--project",
                "tsconfig.json",
            ], {
                cwd: workingDirectory,
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
                signal,
            });

            return { output: `${stdout}\n${stderr}`, exitCode: 0 };
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }

            const commandError = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
            if (typeof commandError.code !== "number") {
                throw error;
            }

            return {
                output: `${String(commandError.stdout ?? "")}\n${String(commandError.stderr ?? "")}`,
                exitCode: commandError.code,
            };
        }
    },
};

interface ParsedDiagnostic {
    file: string;
    line: number;
    code: string;
    message: string;
}

const redactText = (value: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(value).content);

const normalizeRepositoryPath = (workingDirectory: string, file: string): string | undefined => {
    const normalizedDirectory = workingDirectory.replaceAll("\\", "/").replace(/\/$/, "");
    const normalizedFile = file.replaceAll("\\", "/");

    if (normalizedFile === normalizedDirectory) {
        return undefined;
    }

    if (normalizedFile.startsWith(`${normalizedDirectory}/`)) {
        return normalizedFile.slice(normalizedDirectory.length + 1);
    }

    return normalizedFile.startsWith("../") || /^[A-Za-z]:\//.test(normalizedFile)
        ? undefined
        : normalizedFile;
};

const parseDiagnostics = (output: string): ParsedDiagnostic[] => output.split(/\r?\n/)
    .flatMap((line) => {
        const match = diagnosticPattern.exec(line);
        if (match === null) {
            return [];
        }

        const [, file, lineNumber, , code, message] = match;
        if (file === undefined || lineNumber === undefined || code === undefined || message === undefined) {
            return [];
        }

        return [{ file, line: Number(lineNumber), code, message }];
    });

/**
 * 将 TypeScript 编译器的本地诊断转换为当前变更中新增行的确定性发现项。
 *
 * 编译器可读取当前检出的完整提交，但任何未映射到安全 diff 分块的诊断都不会
 * 离开适配器，从而避免把历史问题或敏感文件路径发布为本次评审结果。
 */
export class TypeScriptReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {
        kind: "typecheck",
        id: "typescript",
        verificationEligible: true,
    };

    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: false,
        supportsRepositoryScan: true,
    };

    public constructor(
        private readonly workingDirectory: string,
        private readonly commandRunner: TypeScriptCommandRunner = defaultCommandRunner,
    ) {}

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        const result = await this.commandRunner.run(this.workingDirectory, request.signal);
        const diagnostics = parseDiagnostics(result.output);
        const findings = diagnostics.flatMap((diagnostic): ReviewCandidate[] => {
            const file = normalizeRepositoryPath(this.workingDirectory, diagnostic.file);
            if (file === undefined) {
                return [];
            }

            const locatedEvidence = findAddedLineEvidence(request.codeChange, file, diagnostic.line);
            if (locatedEvidence === undefined) {
                return [];
            }

            return [{
                severity: "high",
                title: `TypeScript error TS${diagnostic.code}`,
                description: redactText(diagnostic.message),
                file,
                line: diagnostic.line,
                category: "typecheck",
                chunkId: locatedEvidence.chunk.id,
                evidence: locatedEvidence.evidence,
            }];
        });

        if (result.exitCode !== 0 && diagnostics.length === 0) {
            throw new Error("TypeScript did not return file diagnostics for the configured project.");
        }

        return {
            summary: `TypeScript completed with ${diagnostics.length} diagnostic(s); ${findings.length} mapped to changed added lines.`,
            findings,
        };
    }
}
