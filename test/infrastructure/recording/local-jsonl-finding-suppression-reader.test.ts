import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {
    LocalJsonlFindingSuppressionReader
} from "../../../src/infrastructure/recording/local-jsonl-finding-suppression-reader.js";

const fingerprint = "0123456789abcdef01234567";

describe("LocalJsonlFindingSuppressionReader", () => {
    it("suppresses current false positives, expires them, and allows an explicit revocation", async () => {
        const directory = await mkdtemp(join(tmpdir(), "aicr-suppression-"));
        const path = join(directory, "runs.jsonl");
        try {
            await writeFile(path, [
                JSON.stringify({
                    schemaVersion: "v1",
                    recordType: "finding-feedback",
                    feedbackId: "40e4c6ec-8be2-4de2-9d5e-54cda88a3cf0",
                    fingerprint,
                    status: "false-positive",
                    recordedAt: "2026-09-02T00:00:00.000Z",
                    expiresAt: "2026-10-02T00:00:00.000Z",
                }),
            ].join("\n").concat("\n"), "utf8");

            const reader = new LocalJsonlFindingSuppressionReader(path);
            await expect(reader.getActiveSuppressedFingerprints(new Date("2026-09-03T00:00:00.000Z")))
                .resolves.toEqual([fingerprint]);
            await expect(reader.getActiveSuppressedFingerprints(new Date("2026-11-03T00:00:00.000Z")))
                .resolves.toEqual([]);

            await writeFile(path, `${await readFile(path, "utf8")}${JSON.stringify({
                schemaVersion: "v1",
                recordType: "finding-feedback",
                feedbackId: "5ff86dc0-213b-4dc0-9490-ad8a8d15e99a",
                fingerprint,
                status: "accepted",
                recordedAt: "2026-09-04T00:00:00.000Z",
            })}\n`, "utf8");

            await expect(reader.getActiveSuppressedFingerprints(new Date("2026-09-05T00:00:00.000Z")))
                .resolves.toEqual([]);
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    });

    it("treats a missing local record as no suppression", async () => {
        const directory = await mkdtemp(join(tmpdir(), "aicr-suppression-"));
        try {
            await expect(new LocalJsonlFindingSuppressionReader(join(directory, "missing.jsonl"))
                .getActiveSuppressedFingerprints()).resolves.toEqual([]);
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    });
});
