import {readFile} from "node:fs/promises";
import {z} from "zod";
import type {ReviewQualityRecordReaderPort} from "../../application/review/ports/review-quality-record-reader-port.js";
import type {SanitizedQualityRecord} from "../../application/review/ports/review-run-record-port.js";

const analyzerRunSchema = z.object({
    analyzerId: z.string(),
    status: z.enum(["completed", "degraded", "failed"]),
    // v1 早期记录未保存尝试次数，读取时按一次兼容处理。
    attempts: z.number().int().nonnegative().optional().default(1),
    failureReason: z.enum([
        "request",
        "authentication",
        "rate-limit",
        "timeout",
        "incomplete-response",
        "invalid-json",
        "invalid-schema",
        "content-filtered",
        "context-limit",
        "unknown",
        "not-registered",
        "execution",
    ]).optional(),
    durationMs: z.number().nonnegative(),
}).transform(({failureReason, ...run}) => ({
    ...run,
    ...(failureReason === undefined ? {} : {failureReason}),
}));

const recordedFindingSchema = z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    verificationStatus: z.enum(["grounded", "anchored", "corroborated", "verified", "unavailable"]),
    disposition: z.enum(["advisory", "defect", "unverifiable"]).optional(),
    analyzerIds: z.array(z.string()),
}).transform(({disposition, verificationStatus, ...finding}) => ({
    ...finding,
    verificationStatus: verificationStatus === "grounded" ? "anchored" : verificationStatus,
    disposition: disposition ?? (verificationStatus === "verified"
        ? "defect"
        : verificationStatus === "unavailable"
            ? "unverifiable"
            : "advisory"),
}));

const reviewRunRecordSchema = z.object({
    schemaVersion: z.literal("v1"),
    recordType: z.literal("review-run").optional(),
    runId: z.string().uuid(),
    recordedAt: z.string().datetime(),
    qualityGateFailed: z.boolean(),
    highestSeverity: z.enum(["info", "low", "medium", "high", "critical"]).nullable(),
    analyzerRuns: z.array(analyzerRunSchema),
    findings: z.array(recordedFindingSchema),
}).transform((record) => ({ ...record, recordType: "review-run" as const }));

const feedbackRecordSchema = z.object({
    schemaVersion: z.literal("v1"),
    recordType: z.literal("finding-feedback"),
    feedbackId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    status: z.enum(["accepted", "false-positive", "not-applicable", "fixed"]),
    recordedAt: z.string().datetime(),
    runId: z.string().uuid().optional(),
    expiresAt: z.string().datetime().optional(),
}).transform(({runId, expiresAt, ...record}) => ({
    ...record,
    ...(runId === undefined ? {} : { runId }),
    ...(expiresAt === undefined ? {} : {expiresAt}),
}));

const qualityRecordSchema = z.union([reviewRunRecordSchema, feedbackRecordSchema]);

/** 读取并严格校验本地 JSONL 脱敏质量事件。 */
export class LocalJsonlReviewQualityRecordReader implements ReviewQualityRecordReaderPort {
    public constructor(private readonly path: string) {}

    public async readAll(): Promise<SanitizedQualityRecord[]> {
        const content = await readFile(this.path, "utf8");
        const records: SanitizedQualityRecord[] = [];
        for (const line of content.split(/\r?\n/u)) {
            if (line.trim().length === 0) {
                continue;
            }
            records.push(qualityRecordSchema.parse(JSON.parse(line)));
        }
        return records;
    }
}
