import type { ManualReviewResult } from "../../application/run-manual-review-use-case.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../domain/review/sensitive-content-policy.js";
import type { ReviewFinding } from "../../domain/review/review-finding.js";
import type { NotificationDelivery } from "../../application/publish-notification-use-case.js";

/**
 * 渲染手动评审 CI 报告所需的接口层输入。
 */
export interface ManualReviewReportInput {
    target: string;
    result: ManualReviewResult;
    wecomDelivery?: NotificationDelivery | { status: "disabled" } | { status: "pending" };
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

const redactText = (value: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(value).content);

const formatLocation = (finding: ReviewFinding): string => {
    if (finding.file === undefined || isSensitiveFile({
        path: finding.file,
        status: "modified",
    })) {
        return "";
    }

    const line = finding.line === undefined ? "" : `:${finding.line}`;
    return ` (${redactText(finding.file)}${line})`;
};

const formatFinding = (finding: ReviewFinding, index: number): string => {
    const suggestion = finding.suggestion === undefined
        ? ""
        : `\n  Suggestion: ${redactText(finding.suggestion)}`;

    return `${index + 1}. [${finding.severity}] ${redactText(finding.title)}${formatLocation(finding)}\n   ${redactText(finding.description)}${suggestion}`;
};

/**
 * 将安全的手动评审结果渲染为 CI 与通知渠道可复用的 Markdown。
 */
export const renderManualReviewReport = (
    input: ManualReviewReportInput,
): string => {
    const { codeChange, analysis, policy } = input.result;
    const status = policy.shouldFail ? "QUALITY GATE FAILED" : "PASSED";
    const findings = analysis.findings.length === 0
        ? "No actionable findings."
        : analysis.findings.map(formatFinding).join("\n\n");

    return [
        "## AI Code Review",
        "",
        `- Status: ${status}`,
        `- Target: ${redactText(input.target)}`,
        `- Highest severity: ${policy.highestSeverity ?? "none"}`,
        `- Findings: ${analysis.findings.length}`,
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
        "### Delivery Status",
        "",
        "- CI Log: delivered",
        formatWeComDelivery(input.wecomDelivery),
    ].join("\n");
};
