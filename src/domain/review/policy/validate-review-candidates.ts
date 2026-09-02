import type {CodeChange, DiffChunk} from "../model/code-change.js";
import type {
    CandidateSuppressionReason,
    CandidateValidationResult,
    ReviewCandidate,
    ValidatedFinding,
} from "../model/review-candidate.js";
import {createFindingFingerprint} from "./create-finding-fingerprint.js";

const suppress = (
    suppressedCounts: CandidateValidationResult["suppressedCounts"],
    reason: CandidateSuppressionReason,
): void => {
    suppressedCounts[reason] = (suppressedCounts[reason] ?? 0) + 1;
};

const hasMatchingLocation = (candidate: ReviewCandidate, chunk: DiffChunk): boolean => {
    if (candidate.file !== undefined && candidate.file !== chunk.path) {
        return false;
    }

    if (candidate.line === undefined) {
        return true;
    }

    return chunk.newRange !== undefined
        && candidate.line >= chunk.newRange.startLine
        && candidate.line <= chunk.newRange.endLine;
};

/**
 * `[REDACTED]` 表示模型无法获得原始值，不能作为推导语法、配置或业务结论的依据。
 * 高置信度密钥扫描由确定性分析器承担，因此只抑制 AI 产生的此类候选。
 */
const dependsOnRedactedPlaceholder = (candidate: ReviewCandidate): boolean => candidate.analyzer?.kind === "ai"
    && [candidate.title, candidate.description, candidate.suggestion, candidate.evidence]
        .some((value) => value?.includes("[REDACTED]") ?? false);

/**
 * 仅保留能够映射到当前已脱敏变更块、且证据文本真实存在的候选项。
 *
 * 此验证不尝试证明业务结论正确；它只建立可追溯性，因此结果状态为
 * `grounded`，不能单独触发质量门禁。
 */
export const validateReviewCandidates = (
    candidates: readonly ReviewCandidate[],
    codeChange: CodeChange,
): CandidateValidationResult => {
    const chunks = new Map(codeChange.chunks.map((chunk) => [chunk.id, chunk]));
    const findings: ValidatedFinding[] = [];
    const suppressedCounts: CandidateValidationResult["suppressedCounts"] = {};

    for (const candidate of candidates) {
        if (dependsOnRedactedPlaceholder(candidate)) {
            suppress(suppressedCounts, "redacted-dependency");
            continue;
        }

        if (candidate.chunkId === undefined) {
            suppress(suppressedCounts, "missing-chunk-reference");
            continue;
        }

        const chunk = chunks.get(candidate.chunkId);
        if (chunk === undefined) {
            suppress(suppressedCounts, "unknown-chunk");
            continue;
        }

        if (!hasMatchingLocation(candidate, chunk)) {
            suppress(suppressedCounts, "location-mismatch");
            continue;
        }

        if (candidate.evidence === undefined || candidate.evidence.trim().length === 0) {
            suppress(suppressedCounts, "missing-evidence");
            continue;
        }

        if (!chunk.content.includes(candidate.evidence)) {
            suppress(suppressedCounts, "evidence-mismatch");
            continue;
        }

        const finding = {
            severity: candidate.severity,
            title: candidate.title,
            description: candidate.description,
            chunkId: candidate.chunkId,
            evidence: candidate.evidence,
            verificationStatus: "grounded",
            disposition: "advisory",
            verificationMethods: [
                "diff-anchor",
                ...(candidate.line === undefined ? [] : ["source-range" as const]),
                "evidence-match",
            ],
            ...(candidate.analyzer === undefined ? {} : { analyzer: candidate.analyzer }),
            analyzers: candidate.analyzer === undefined ? [] : [candidate.analyzer],
            ...(candidate.file === undefined ? {} : { file: candidate.file }),
            ...(candidate.line === undefined ? {} : { line: candidate.line }),
            ...(candidate.category === undefined ? {} : { category: candidate.category }),
            ...(candidate.suggestion === undefined ? {} : { suggestion: candidate.suggestion }),
            ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
        } satisfies Omit<ValidatedFinding, "fingerprint">;

        findings.push({
            ...finding,
            fingerprint: createFindingFingerprint(finding),
        });
    }

    return { findings, suppressedCounts };
};
