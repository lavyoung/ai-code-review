import {describe, expect, it, vi} from "vitest";
import {GitCommittedContractSource} from "../../../src/infrastructure/impact/git-committed-contract-source.js";

describe("GitCommittedContractSource", () => {
    it("reads only requested documents from a committed revision", async () => {
        const run = vi.fn(async (arguments_: readonly string[]) => {
            if (arguments_[0] === "rev-parse") {
                return "head-sha\n";
            }
            if (arguments_.at(-1) === "head-sha:contracts/openapi.yaml") {
                return "openapi: 3.1.0\npaths: {}\n";
            }
            if (arguments_.at(-1) === "head-sha:contracts/deleted.yaml") {
                throw Object.assign(new Error("missing"), {code: 128});
            }
            throw new Error(`Unexpected Git operation: ${arguments_.join(" ")}`);
        });
        const source = new GitCommittedContractSource("D:/repository", {run});

        const result = await source.read({
            baseRef: "base",
            headRef: "head",
            comparison: "two-dot",
        }, "head", ["contracts/openapi.yaml", "contracts/deleted.yaml"], AbortSignal.timeout(1_000));

        expect(result).toEqual({
            status: "available",
            documents: [{path: "contracts/openapi.yaml", content: "openapi: 3.1.0\npaths: {}\n"}],
        });
        expect(run).toHaveBeenCalledWith([
            "show",
            "--no-textconv",
            "head-sha:contracts/openapi.yaml",
        ], expect.any(AbortSignal));
        expect(run.mock.calls.flatMap(([arguments_]) => arguments_ as string[])).not.toContain("ls-tree");
    });

    it("rejects repository-escaping paths before invoking Git", async () => {
        const run = vi.fn();
        const source = new GitCommittedContractSource("D:/repository", {run});

        const result = await source.read({
            baseRef: "base",
            headRef: "head",
            comparison: "two-dot",
        }, "head", ["../outside/openapi.yaml"], AbortSignal.timeout(1_000));

        expect(result).toEqual({status: "unavailable", documents: []});
        expect(run).not.toHaveBeenCalled();
    });
});
