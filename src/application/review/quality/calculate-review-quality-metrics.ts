import {
    FINDING_FEEDBACK_STATUSES,
    type FindingFeedbackStatus,
    type SanitizedFindingFeedback,
    type SanitizedQualityRecord,
    type SanitizedReviewRunRecord,
} from "../ports/review-run-record-port.js";

/** 单个分析器的脱敏运行聚合。 */
export interface AnalyzerQualityMetrics {
    analyzerId: string;
    completedCount: number;
    degradedCount: number;
    failedCount: number;
    averageDurationMs: number;
}

/** 本地记录可得的质量指标；不含仓库路径、代码、文本或密钥。 */
export interface ReviewQualityMetrics {
    schemaVersion: "v1";
    recordType: "review-quality-metrics";
    runCount: number;
    qualityGateFailureCount: number;
    findingCount: number;
    uniqueFindingCount: number;
    feedbackEventCount: number;
    latestFeedbackCounts: Record<FindingFeedbackStatus, number>;
    matchedFeedbackEventCount: number;
    unmatchedFeedbackEventCount: number;
    feedbackCoveragePercent: number | null;
    falsePositiveRatePercent: number | null;
    averageFeedbackResolutionMs: number | null;
    analyzers: AnalyzerQualityMetrics[];
}

interface AnalyzerAggregate {
    completedCount: number;
    degradedCount: number;
    failedCount: number;
    totalDurationMs: number;
}

const emptyFeedbackCounts = (): Record<FindingFeedbackStatus, number> => ({
    accepted: 0,
    "false-positive": 0,
    "not-applicable": 0,
    fixed: 0,
});

const toTimestamp = (value: string): number | undefined => {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
};

const isLaterFeedback = (
    candidate: SanitizedFindingFeedback,
    current: SanitizedFindingFeedback | undefined,
): boolean => {
    if (current === undefined) {
        return true;
    }

    const candidateTimestamp = toTimestamp(candidate.recordedAt);
    const currentTimestamp = toTimestamp(current.recordedAt);
    return candidateTimestamp !== undefined
        && (currentTimestamp === undefined || candidateTimestamp > currentTimestamp);
};

/**
 * 基于脱敏运行与反馈事件计算本地指标。
 *
 * 同一指纹的反馈以最新事件为准；反馈耗时只在 runId 指向包含该指纹的运行时计算。
 */
export const calculateReviewQualityMetrics = (
    records: SanitizedQualityRecord[],
): ReviewQualityMetrics => {
    const runs: SanitizedReviewRunRecord[] = [];
    const feedbackEvents: SanitizedFindingFeedback[] = [];
    for (const record of records) {
        if (record.recordType === "review-run") {
            runs.push(record);
        } else {
            feedbackEvents.push(record);
        }
    }

    const fingerprints = new Set<string>();
    const runFindingKeys = new Set<string>();
    const runRecordedAtById = new Map<string, string>();
    const analyzerAggregates = new Map<string, AnalyzerAggregate>();
    let findingCount = 0;
    let qualityGateFailureCount = 0;

    for (const run of runs) {
        if (run.qualityGateFailed) {
            qualityGateFailureCount += 1;
        }
        runRecordedAtById.set(run.runId, run.recordedAt);
        for (const finding of run.findings) {
            findingCount += 1;
            fingerprints.add(finding.fingerprint);
            runFindingKeys.add(`${run.runId}:${finding.fingerprint}`);
        }
        for (const analyzerRun of run.analyzerRuns) {
            const aggregate = analyzerAggregates.get(analyzerRun.analyzerId) ?? {
                completedCount: 0,
                degradedCount: 0,
                failedCount: 0,
                totalDurationMs: 0,
            };
            switch (analyzerRun.status) {
                case "completed":
                    aggregate.completedCount += 1;
                    break;
                case "degraded":
                    aggregate.degradedCount += 1;
                    break;
                case "failed":
                    aggregate.failedCount += 1;
                    break;
            }
            aggregate.totalDurationMs += analyzerRun.durationMs;
            analyzerAggregates.set(analyzerRun.analyzerId, aggregate);
        }
    }

    const latestFeedbackByFingerprint = new Map<string, SanitizedFindingFeedback>();
    let matchedFeedbackEventCount = 0;
    const resolutionDurations: number[] = [];
    for (const feedback of feedbackEvents) {
        const previous = latestFeedbackByFingerprint.get(feedback.fingerprint);
        if (isLaterFeedback(feedback, previous)) {
            latestFeedbackByFingerprint.set(feedback.fingerprint, feedback);
        }
        if (fingerprints.has(feedback.fingerprint)) {
            matchedFeedbackEventCount += 1;
        }
        if (feedback.runId !== undefined && runFindingKeys.has(`${feedback.runId}:${feedback.fingerprint}`)) {
            const runTimestamp = toTimestamp(runRecordedAtById.get(feedback.runId) ?? "");
            const feedbackTimestamp = toTimestamp(feedback.recordedAt);
            if (runTimestamp !== undefined && feedbackTimestamp !== undefined && feedbackTimestamp >= runTimestamp) {
                resolutionDurations.push(feedbackTimestamp - runTimestamp);
            }
        }
    }

    const latestFeedbackCounts = emptyFeedbackCounts();
    for (const feedback of latestFeedbackByFingerprint.values()) {
        if (fingerprints.has(feedback.fingerprint)) {
            latestFeedbackCounts[feedback.status] += 1;
        }
    }
    const latestFeedbackCount = [...FINDING_FEEDBACK_STATUSES]
        .reduce((total, status) => total + latestFeedbackCounts[status], 0);
    const falsePositiveRatePercent = latestFeedbackCount === 0
        ? null
        : (latestFeedbackCounts["false-positive"] / latestFeedbackCount) * 100;

    return {
        schemaVersion: "v1",
        recordType: "review-quality-metrics",
        runCount: runs.length,
        qualityGateFailureCount,
        findingCount,
        uniqueFindingCount: fingerprints.size,
        feedbackEventCount: feedbackEvents.length,
        latestFeedbackCounts,
        matchedFeedbackEventCount,
        unmatchedFeedbackEventCount: feedbackEvents.length - matchedFeedbackEventCount,
        feedbackCoveragePercent: fingerprints.size === 0
            ? null
            : (new Set(
                [...latestFeedbackByFingerprint.keys()].filter((fingerprint) => fingerprints.has(fingerprint)),
            ).size / fingerprints.size) * 100,
        falsePositiveRatePercent,
        averageFeedbackResolutionMs: resolutionDurations.length === 0
            ? null
            : resolutionDurations.reduce((total, duration) => total + duration, 0) / resolutionDurations.length,
        analyzers: [...analyzerAggregates.entries()]
            .map(([analyzerId, aggregate]) => ({
                analyzerId,
                completedCount: aggregate.completedCount,
                degradedCount: aggregate.degradedCount,
                failedCount: aggregate.failedCount,
                averageDurationMs: aggregate.totalDurationMs
                    / (aggregate.completedCount + aggregate.degradedCount + aggregate.failedCount),
            }))
            .sort((left, right) => left.analyzerId.localeCompare(right.analyzerId)),
    };
};
