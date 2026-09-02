import type { ReviewAnalysis } from "../../../domain/review/model/review-finding.js";
import type { ReviewCandidate } from "../../../domain/review/model/review-candidate.js";
import type { RawCodeChange } from "../../../domain/review/model/code-change.js";
import { findAddedLineEvidence } from "../../../domain/review/policy/find-added-line-evidence.js";
import {
    containsHighConfidenceSecret,
    isSensitiveFile,
} from "../../../domain/review/policy/sensitive-content-policy.js";
import type {
    AnalysisRequest,
    AnalyzerIdentity,
    ReviewAnalyzer,
} from "../../../application/review/ports/review-analyzer-port.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const isTrustedLocalRequest = (request: AnalysisRequest): request is AnalysisRequest & {
    rawCodeChange: RawCodeChange;
} => "rawCodeChange" in request;

/** 返回新增且包含高置信度凭据特征的行号；不返回原始行内容。 */
const findAddedSecretLineNumbers = (diff: string): number[] => {
    const lineNumbers: number[] = [];
    let newLineNumber: number | undefined;
    for (const line of diff.split("\n")) {
        const hunk = HUNK_HEADER.exec(line);
        if (hunk !== null) {
            newLineNumber = Number(hunk[1]);
            continue;
        }
        if (newLineNumber === undefined || line.startsWith("\\ No newline")) {
            continue;
        }
        if (line.startsWith("+")) {
            if (!line.startsWith("+++") && containsHighConfidenceSecret(line.slice(1))) {
                lineNumbers.push(newLineNumber);
            }
            newLineNumber += 1;
            continue;
        }
        if (line.startsWith(" ")) {
            newLineNumber += 1;
        }
    }
    return lineNumbers;
};

/**
 * 扫描原始已提交 diff 中的高置信度凭据特征。
 *
 * 原始值和敏感路径永不出现在候选项；每项仅通过已脱敏 diff 中的锚点对外发布。
 */
export class SecretScanReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = { kind: "secret-scan", id: "secret-scan" };

    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    };

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        if (!isTrustedLocalRequest(request)) {
            throw new Error("Secret scanning requires trusted raw local input.");
        }

        const findings = request.rawCodeChange.fileChanges.flatMap((fileChange): ReviewCandidate[] => {
            if (isSensitiveFile(fileChange.file)) {
                return [];
            }
            return findAddedSecretLineNumbers(fileChange.diff).flatMap((line) => {
                const located = findAddedLineEvidence(request.codeChange, fileChange.file.path, line);
                if (located === undefined || !located.evidence.includes("[REDACTED]")) {
                    return [];
                }
                return [{
                    severity: "critical",
                    title: "Potential credential committed",
                    description: "A high-confidence credential pattern was added to committed code.",
                    suggestion: "Revoke the exposed credential and load it from a secret manager.",
                    category: "secret",
                    file: fileChange.file.path,
                    line,
                    chunkId: located.chunk.id,
                    evidence: located.evidence,
                }];
            });
        });

        return {
            summary: `Secret scan completed with ${findings.length} verified candidate(s).`,
            findings,
        };
    }
}
