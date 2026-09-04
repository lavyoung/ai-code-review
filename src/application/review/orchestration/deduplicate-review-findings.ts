import type {ValidatedFinding} from "../../../domain/review/model/review-candidate.js";
import {createFindingFingerprint} from "../../../domain/review/policy/create-finding-fingerprint.js";

const uniqueAnalyzers = (findings: readonly ValidatedFinding[]) => Array.from(new Map(
    findings.flatMap((finding) => finding.analyzers).map((analyzer) => [
        `${analyzer.kind}:${analyzer.id}:${analyzer.version ?? ""}`,
        analyzer,
    ]),
).values());

/** 合并同次运行的同一发现，优先保留已验证的版本和全部受控来源。 */
export const deduplicateReviewFindings = (
    findings: readonly ValidatedFinding[],
): ValidatedFinding[] => {
    const groups = new Map<string, ValidatedFinding[]>();

    for (const finding of findings) {
        const fingerprint = createFindingFingerprint(finding);
        groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), finding]);
    }

    return Array.from(groups, ([fingerprint, duplicates]) => {
        const primary = duplicates.find((finding) => finding.verificationStatus === "verified") ?? duplicates[0];
        if (primary === undefined) {
            throw new Error("Finding deduplication group was empty.");
        }

        return {
            ...primary,
            fingerprint,
            analyzers: uniqueAnalyzers(duplicates),
            verificationStatus: duplicates.some((finding) => finding.verificationStatus === "verified")
                ? "verified"
                : duplicates.some((finding) => finding.verificationStatus === "corroborated")
                    ? "corroborated"
                    : duplicates.some((finding) => finding.verificationStatus === "unavailable")
                        ? "unavailable"
                        : "anchored",
            disposition: duplicates.some((finding) => finding.disposition === "defect")
                ? "defect"
                : duplicates.some((finding) => finding.disposition === "unverifiable")
                    ? "unverifiable"
                    : "advisory",
            verificationMethods: [...new Set(duplicates.flatMap((finding) => finding.verificationMethods))],
        };
    });
};
