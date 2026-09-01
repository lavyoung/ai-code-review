import type { ManualReviewResult } from "../../../application/review/use-cases/run-manual-review-use-case.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../../domain/review/policy/sensitive-content-policy.js";
import type { ValidatedFinding } from "../../../domain/review/model/review-candidate.js";
import type { NotificationDelivery } from "../../../application/delivery/use-cases/publish-notification-use-case.js";
import type { ReviewCommentPublication } from "../../../application/delivery/use-cases/publish-review-comment-use-case.js";

/**
 * 渲染手动评审 CI 报告所需的接口层输入。
 */
export interface ManualReviewReportInput {
    target: string;
    result: ManualReviewResult;
    includeDeliveryStatus?: boolean;
    wecomDelivery?: NotificationDelivery | { status: "disabled" } | { status: "pending" };
    githubCommentDelivery?: ReviewCommentPublication | { status: "disabled" };
    codeupCommentDelivery?: ReviewCommentPublication | { status: "disabled" };
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

const formatGitHubCommentDelivery = (
    delivery: ManualReviewReportInput["githubCommentDelivery"],
): string | undefined => delivery === undefined
    ? undefined
    : `- GitHub PR comment: ${delivery.status}`;

const formatCodeUpCommentDelivery = (
    delivery: ManualReviewReportInput["codeupCommentDelivery"],
): string | undefined => delivery === undefined
    ? undefined
    : `- CodeUp MR comment: ${delivery.status}`;

/** 渲染不会重复包含评审发现项的最终投递状态。 */
export const renderReviewDeliveryStatus = (
    input: Pick<
        ManualReviewReportInput,
        "wecomDelivery" | "githubCommentDelivery" | "codeupCommentDelivery"
    >,
): string => [
    "## AI Code Review Delivery",
    "",
    "- CI Log: delivered",
    formatWeComDelivery(input.wecomDelivery),
    formatGitHubCommentDelivery(input.githubCommentDelivery),
    formatCodeUpCommentDelivery(input.codeupCommentDelivery),
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

    return `${index + 1}. [${finding.severity}] ${redactText(finding.title)}${formatLocation(finding)}\n   ${redactText(finding.description)}${suggestion}`;
};

/**
 * 将安全的手动评审结果渲染为 CI 与通知渠道可复用的 Markdown。
 */
export const renderReviewReport = (
    input: ManualReviewReportInput,
): string => {
    const { codeChange, analysis, findings: validatedFindings, policy } = input.result;
    const status = policy.shouldFail ? "QUALITY GATE FAILED" : "PASSED";
    const findings = validatedFindings.length === 0
        ? "No actionable findings."
        : validatedFindings.map(formatFinding).join("\n\n");

    return [
        "## AI Code Review",
        "",
        `- Status: ${status}`,
        `- Target: ${redactText(input.target)}`,
        `- Highest severity: ${policy.highestSeverity ?? "none"}`,
        `- Findings: ${validatedFindings.length}`,
        `- Filtered candidates: ${Object.values(input.result.suppressedCandidateCounts)
            .reduce((total, count) => total + count, 0)}`,
        `- Changed files: ${codeChange.files.length}`,
        `- Excluded sensitive files: ${codeChange.excludedFileCount}`,
        `- Redacted values: ${codeChange.redactedValueCount}`,
        "",
        "### Summary",
        "",
        redactText(analysis.summary),
        "",
        "### Findings",
        "",
        findings,
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
