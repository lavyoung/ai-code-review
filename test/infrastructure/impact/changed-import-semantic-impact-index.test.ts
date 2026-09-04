import {describe, expect, it} from "vitest";
import {ChangedImportSemanticImpactIndex} from "../../../src/infrastructure/impact/changed-import-semantic-impact-index.js";

const codeChange = {
    diff: "",
    files: [
        {path: "src/example.ts", status: "modified" as const},
        {path: "src/Example.java", status: "modified" as const},
        {path: "src/app.py", status: "modified" as const},
    ],
    chunks: [{
        id: "typescript-chunk",
        path: "src/example.ts",
        newRange: {startLine: 1, endLine: 2},
        content: "@@ -0,0 +1,2 @@\n+import service from './service.js';\n+const lazy = import(name);",
    }, {
        id: "java-chunk",
        path: "src/Example.java",
        newRange: {startLine: 1, endLine: 1},
        content: "@@ -0,0 +1 @@\n+import com.example.Service;",
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("ChangedImportSemanticImpactIndex", () => {
    it("extracts only added static imports and reports dynamic or unsupported scope as limits", async () => {
        const result = await new ChangedImportSemanticImpactIndex().analyze({
            fileChanges: [{
                file: {path: "src/example.ts", status: "modified"},
                diff: "@@ -0,0 +1,2 @@\n+import service from './service.js';\n+const lazy = import(name);",
            }, {
                file: {path: "src/Example.java", status: "modified"},
                diff: "@@ -0,0 +1 @@\n+import com.example.Service;",
            }, {
                file: {path: "src/app.py", status: "modified"},
                diff: "@@ -0,0 +1 @@\n+import service",
            }],
        }, codeChange, AbortSignal.timeout(1_000));

        expect(result.relations).toEqual([
            expect.objectContaining({
                changeAnchorId: "typescript-chunk",
                sourceLine: 1,
                target: "./service.js",
                kind: "module-import",
                completeness: "partial",
            }),
            expect.objectContaining({
                changeAnchorId: "java-chunk",
                sourceLine: 1,
                target: "com.example.Service",
                kind: "java-import",
            }),
        ]);
        expect(result.limitations).toEqual([
            "dynamic-dependency-unavailable",
            "unsupported-language",
        ]);
    });
});
