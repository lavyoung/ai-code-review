import {describe, expect, it, vi} from "vitest";
import {GitCommittedRevisionSource} from "../../../src/infrastructure/impact/git-committed-revision-source.js";

describe("GitCommittedRevisionSource", () => {
    it("reads the three-dot merge base from Git objects without using workspace files", async () => {
        const run = vi.fn()
            .mockResolvedValueOnce("base-ref-sha\n")
            .mockResolvedValueOnce("head-ref-sha\n")
            .mockResolvedValueOnce("base-sha\n")
            .mockResolvedValueOnce("src/service.ts\0README.md\0.env\0")
            .mockResolvedValueOnce("export function execute() {}\n");
        const source = new GitCommittedRevisionSource("D:/repository", {run});
        const signal = AbortSignal.timeout(1_000);

        const snapshot = await source.read({
            baseRef: "main",
            headRef: "feature",
            comparison: "three-dot",
        }, "base", signal);

        expect(snapshot).toEqual({
            status: "available",
            files: [{
                path: "src/service.ts",
                language: "typescript",
                content: "export function execute() {}\n",
            }],
        });
        expect(run).toHaveBeenNthCalledWith(1, ["rev-parse", "--verify", "--end-of-options", "main^{commit}"], signal);
        expect(run).toHaveBeenNthCalledWith(2, ["rev-parse", "--verify", "--end-of-options", "feature^{commit}"], signal);
        expect(run).toHaveBeenNthCalledWith(3, ["merge-base", "base-ref-sha", "head-ref-sha"], signal);
        expect(run).toHaveBeenNthCalledWith(4, ["ls-tree", "-r", "-z", "--name-only", "base-sha", "--"], signal);
        expect(run).toHaveBeenNthCalledWith(5, ["show", "--no-textconv", "base-sha:src/service.ts"], signal);
    });

    it("degrades when the committed revision cannot be listed", async () => {
        const source = new GitCommittedRevisionSource("D:/repository", {
            run: vi.fn().mockRejectedValue(new Error("unavailable")),
        });

        await expect(source.read({
            baseRef: "base",
            headRef: "head",
            comparison: "two-dot",
        }, "head", AbortSignal.timeout(1_000))).resolves.toEqual({status: "unavailable", files: []});
    });
});
