import type {ManualReviewResult} from "../../../application/review/use-cases/run-manual-review-use-case.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";
import type {ValidatedFinding} from "../../../domain/review/model/review-candidate.js";
import type {NotificationDelivery} from "../../../application/delivery/use-cases/publish-notification-use-case.js";
import type {
    ReviewCommentPublication
} from "../../../application/delivery/use-cases/publish-review-comment-use-case.js";

/** 平台适配器提供的摘要评论投递状态；标签由适配器确定，避免 CLI 识别平台。 */
export interface SummaryCommentDeliveryStatus {
    label: string;
    publication: ReviewCommentPublication | { status: "disabled" };
}

/**
 * 渲染手动评审 CI 报告所需的接口层输入。
 */
export interface ManualReviewReportInput {
    target: string;
    runId?: string;
    result: ManualReviewResult;
    includeDeliveryStatus?: boolean;
    wecomDelivery?: NotificationDelivery | { status: "disabled" } | { status: "pending" };
    summaryCommentDelivery?: SummaryCommentDeliveryStatus;
}

const formatWeComDelivery = (
    delivery: ManualReviewReportInput["wecomDelivery"] = { status: "disabled" },
): string => {
    if (delivery.status === "disabled") {
        return "- WeCom: disabled";
    }

    if (delivery.status === "pending") {
        return "- WeCom: pending";
    }

    return `- WeCom: ${delivery.status} (attempts: ${delivery.attempts})`;
};

const formatSummaryCommentDelivery = (
    delivery: ManualReviewReportInput["summaryCommentDelivery"],
): string | undefined => delivery === undefined
    ? undefined
    : delivery.publication.status === "disabled"
        ? `- ${delivery.label}: disabled`
        : `- ${delivery.label}: ${delivery.publication.status} (attempts: ${delivery.publication.attempts})`;

/** 渲染不会重复包含评审发现项的最终投递状态。 */
export const renderReviewDeliveryStatus = (
    input: Pick<
        ManualReviewReportInput,
        "wecomDelivery" | "summaryCommentDelivery"
    >,
): string => [
    "## AI Code Review Delivery",
    "",
    "- CI Log: delivered",
    formatWeComDelivery(input.wecomDelivery),
    formatSummaryCommentDelivery(input.summaryCommentDelivery),
].filter((line): line is string => line !== undefined).join("\n");

const redactText = (value: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(value).content);

const formatLocation = (finding: ValidatedFinding): string => {
    if (finding.file === undefined || isSensitiveFile({
        path: finding.file,
        status: "modified",
    })) {
        return "";
    }

    const line = finding.line === undefined ? "" : `:${finding.line}`;
    return ` (${redactText(finding.file)}${line})`;
};

const formatFinding = (finding: ValidatedFinding, index: number): string => {
    const suggestion = finding.suggestion === undefined
        ? ""
        : `\n  Suggestion: ${redactText(finding.suggestion)}`;

    return `${index + 1}. [${finding.verificationStatus}] [${finding.severity}] ${redactText(finding.title)}${formatLocation(finding)}\n   ${redactText(finding.description)}${suggestion}\n   Fingerprint: \`${finding.fingerprint}\``;
};

const formatFindings = (findings: readonly ValidatedFinding[], emptyMessage: string): string => findings.length === 0
    ? emptyMessage
    : findings.map(formatFinding).join("\n\n");

const countFindingsByVerificationStatus = (
    findings: readonly ValidatedFinding[],
): Record<ValidatedFinding["verificationStatus"], number> => findings.reduce(
    (counts, finding) => ({ ...counts, [finding.verificationStatus]: counts[finding.verificationStatus] + 1 }),
    { grounded: 0, verified: 0 },
);

const formatAnalyzerRuns = (
    runs: ManualReviewResult["analyzerRuns"] | undefined,
): string | undefined => runs === undefined || runs.length === 0
    ? undefined
    : runs.map((run) => `${run.analyzer.id}=${run.status} (attempts: ${run.attempts}${run.failureReason === undefined
        ? ""
        : `, reason: ${run.failureReason}`})`).join(", ");

/**
 * 将安全的手动评审结果渲染为 CI 与通知渠道可复用的 Markdown。
 */
export const renderReviewReport = (
    input: ManualReviewReportInput,
): string => {
    const {
        codeChange,
        analysis,
        findings: validatedFindings,
        policy,
    } = input.result;
    const status = policy.shouldFail ? "QUALITY GATE FAILED" : "PASSED";
    const verificationCounts = countFindingsByVerificationStatus(validatedFindings);
    const confirmedFindings = validatedFindings.filter((finding) => finding.disposition === "defect");
    const advisoryFindings = validatedFindings.filter((finding) => finding.disposition === "advisory");
    const suppressedCandidateCount = Object.values(input.result.suppressedCandidateCounts)
        .reduce((total, count) => total + count, 0);

    return [
        "## AI Code Review",
        "",
        `- Status: ${status}`,
        ...(input.runId === undefined ? [] : [`- Run ID: ${input.runId}`]),
        `- Target: ${redactText(input.target)}`,
        `- Highest severity: ${policy.highestSeverity ?? "none"}`,
        `- Findings: ${validatedFindings.length}`,
        `- Verified findings: ${verificationCounts.verified}`,
        `- Grounded findings: ${verificationCounts.grounded}`,
        `- Suppressed candidates: ${suppressedCandidateCount}`,
        ...(formatAnalyzerRuns(input.result.analyzerRuns) === undefined
            ? []
            : [`- Analyzer status: ${formatAnalyzerRuns(input.result.analyzerRuns)}`]),
        `- Changed files: ${codeChange.files.length}`,
        `- Excluded sensitive files: ${codeChange.excludedFileCount}`,
        `- Redacted values: ${codeChange.redactedValueCount}`,
        "",
        "### Summary",
        "",
        redactText(analysis.summary),
        "",
        "### Confirmed findings",
        "",
        formatFindings(confirmedFindings, "No confirmed findings."),
        "",
        "### AI suggestions for review",
        "",
        "These suggestions are anchored to the diff but have not been deterministically verified; they do not represent confirmed defects and never affect the quality gate.",
        "",
        formatFindings(advisoryFindings, "No AI suggestions requiring review."),
        "",
        "### Suppressed candidates",
        "",
        suppressedCandidateCount === 0
            ? "No candidates were suppressed."
            : Object.entries(input.result.suppressedCandidateCounts)
                .map(([reason, count]) => `- ${reason}: ${count}`)
                .join("\n"),
        "",
        ...(input.includeDeliveryStatus === false
            ? []
            : [
                "### Delivery Status",
                "",
                renderReviewDeliveryStatus(input).replace("## AI Code Review Delivery\n\n", ""),
            ]),
    ].filter((line): line is string => line !== undefined).join("\n");
};
