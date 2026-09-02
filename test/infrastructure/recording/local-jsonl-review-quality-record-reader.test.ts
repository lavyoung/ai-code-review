import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {
    LocalJsonlReviewQualityRecordReader
} from "../../../src/infrastructure/recording/local-jsonl-review-quality-record-reader.js";

describe("LocalJsonlReviewQualityRecordReader", () => {
    it("reads legacy run records and typed feedback records without exposing raw lines", async () => {
        const directory = await mkdtemp(join(tmpdir(), "aicr-quality-"));
        const path = join(directory, "runs.jsonl");
        try {
            await writeFile(path, [
                JSON.stringify({
                    schemaVersion: "v1",
                    runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
                    recordedAt: "2026-09-02T00:00:00.000Z",
                    qualityGateFailed: false,
                    highestSeverity: null,
                    analyzerRuns: [{
                        analyzerId: "ai:deepseek",
                        status: "degraded",
                        durationMs: 10,
                        failureReason: "rate-limit",
                    }],
                    findings: [],
                }),
                JSON.stringify({
                    schemaVersion: "v1",
                    recordType: "finding-feedback",
                    feedbackId: "40e4c6ec-8be2-4de2-9d5e-54cda88a3cf0",
                    fingerprint: "0123456789abcdef01234567",
                    status: "fixed",
                    recordedAt: "2026-09-02T00:01:00.000Z",
                }),
            ].join("\n"), "utf8");

            await expect(new LocalJsonlReviewQualityRecordReader(path).readAll()).resolves.toEqual([
                expect.objectContaining({
                    recordType: "review-run",
                    analyzerRuns: [expect.objectContaining({
                        attempts: 1,
                        failureReason: "rate-limit",
                    })],
                }),
                expect.objectContaining({ recordType: "finding-feedback", status: "fixed" }),
            ]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("rejects an unclassified failure reason instead of accepting adapter text", async () => {
        const directory = await mkdtemp(join(tmpdir(), "aicr-quality-"));
        const path = join(directory, "runs.jsonl");
        try {
            await writeFile(path, JSON.stringify({
                schemaVersion: "v1",
                runId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
                recordedAt: "2026-09-02T00:00:00.000Z",
                qualityGateFailed: false,
                highestSeverity: null,
                analyzerRuns: [{
                    analyzerId: "ai:deepseek",
                    status: "degraded",
                    attempts: 1,
                    failureReason: "token=secret",
                    durationMs: 10,
                }],
                findings: [],
            }), "utf8");

            await expect(new LocalJsonlReviewQualityRecordReader(path).readAll()).rejects.toBeDefined();
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    });
});
