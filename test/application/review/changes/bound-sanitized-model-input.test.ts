import { describe, expect, it } from "vitest";
import { boundSanitizedModelInput } from "../../../../src/application/review/changes/bound-sanitized-model-input.js";

describe("boundSanitizedModelInput", () => {
    it("keeps an ordered bounded prefix of sanitized chunks", () => {
        const codeChange = {
            diff: "first\nsecond",
            files: [
                { path: "src/first.ts", status: "modified" as const },
                { path: "src/second.ts", status: "modified" as const },
            ],
            chunks: [
                { id: "chunk-1", path: "src/first.ts", content: "a".repeat(80) },
                { id: "chunk-2", path: "src/second.ts", content: "b".repeat(80) },
            ],
            excludedFileCount: 0,
            redactedValueCount: 0,
        };
        const bounded = boundSanitizedModelInput(codeChange, 140);

        expect(JSON.stringify(bounded.chunks).length).toBeLessThanOrEqual(140);
        expect(bounded.chunks).toHaveLength(1);
        expect(bounded.chunks[0]).toMatchObject({ id: "chunk-1", path: "src/first.ts" });
        expect(bounded.files).toEqual([{ path: "src/first.ts", status: "modified" }]);
        expect(bounded.diff).toBe(bounded.chunks[0]?.content);
    });
});
