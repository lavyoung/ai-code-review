import {readFile} from "node:fs/promises";
import {isAbsolute, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
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
    ReviewAnalyzer
} from "../../../application/review/ports/review-analyzer-port.js";

const sarifSchema = z.object({
    version: z.literal("2.1.0"),
    runs: z.array(z.object({
        results: z.array(z.object({
            ruleId: z.string().optional(),
            level: z.enum(["error", "warning", "note", "none"]).optional(),
            message: z.object({ text: z.string() }),
            locations: z.array(z.object({
                physicalLocation: z.object({
                    artifactLocation: z.object({ uri: z.string() }),
                    region: z.object({ startLine: z.number().int().positive() }).optional(),
                }),
            })).optional(),
        })).optional(),
    })),
}).strict();

const redactText = (value: string): string => redactSensitiveFilePaths(redactSensitiveValues(value).content);

const toRepositoryPath = (workingDirectory: string, uri: string): string | undefined => {
    let path = uri;
    if (uri.startsWith("file:")) {
        try {
            path = fileURLToPath(uri);
        } catch {
            return undefined;
        }
    }

    const normalized = isAbsolute(path) ? relative(workingDirectory, path) : path;
    return normalized.startsWith("..") || isAbsolute(normalized)
        ? undefined
        : normalized.replaceAll("\\", "/");
};

const severityFor = (level: "error" | "warning" | "note" | "none" | undefined): "high" | "medium" | "low" => {
    switch (level) {
        case "error": return "high";
        case "warning": return "medium";
        default: return "low";
    }
};

/** 将本地 SARIF 2.1.0 报告中的本次新增行诊断映射为统一确定性发现。 */
export class SarifReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {
        kind: "sast",
        id: "sarif",
        verificationEligible: true,
    };
    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: false,
        supportsRepositoryScan: true,
    };

    public constructor(private readonly workingDirectory: string, private readonly reportPath: string) {}

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        const report = sarifSchema.parse(JSON.parse(await readFile(this.reportPath, "utf8")));
        const findings = report.runs.flatMap((run) => run.results ?? []).flatMap((result): ReviewCandidate[] => {
            const location = result.locations?.[0]?.physicalLocation;
            const line = location?.region?.startLine;
            const file = location === undefined ? undefined : toRepositoryPath(this.workingDirectory, location.artifactLocation.uri);
            if (file === undefined || line === undefined) {
                return [];
            }

            const evidence = findAddedLineEvidence(request.codeChange, file, line);
            if (evidence === undefined) {
                return [];
            }

            const ruleId = result.ruleId ?? "SARIF";
            return [{
                severity: severityFor(result.level),
                title: `SARIF ${redactText(ruleId)}`,
                description: redactText(result.message.text),
                file,
                line,
                category: "sast",
                chunkId: evidence.chunk.id,
                evidence: evidence.evidence,
            }];
        });

        return { summary: `SARIF completed with ${findings.length} mapped finding(s).`, findings };
    }
}
