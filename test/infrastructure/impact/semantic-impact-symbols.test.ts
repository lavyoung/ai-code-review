import {describe, expect, it} from "vitest";
import {ChangedImportSemanticImpactIndex} from "../../../src/infrastructure/impact/changed-import-semantic-impact-index.js";
import type {CodeChange, RawCodeChange} from "../../../src/domain/review/model/code-change.js";

const analyze = async (rawCodeChange: RawCodeChange, codeChange: CodeChange) =>
    new ChangedImportSemanticImpactIndex().analyze(rawCodeChange, codeChange, AbortSignal.timeout(1_000));

describe("semantic impact symbol identity", () => {
    it.each([{
        label: "changed signature",
        before: "export function convert(value: string) { return normalize(value); }",
        after: "export function convert(value: number) { return normalize(value); }",
        status: "overload-changed",
    }, {
        label: "replaced implementation",
        before: "export function convert(value: string) { return oldNormalizer(value); }",
        after: "export function convert(value: string) { return newNormalizer(value); }",
        status: "implementation-replaced",
    }])("classifies a $label without conflating its identity", async ({before, after, status}) => {
        const diff = `@@ -1 +1 @@\n-${before}\n+${after}`;
        const result = await analyze({
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{
                id: "converter-chunk",
                path: "src/converter.ts",
                oldRange: {startLine: 1, endLine: 1},
                newRange: {startLine: 1, endLine: 1},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "symbol-change",
            symbolMapping: expect.objectContaining({status}),
        }));
    });

    it("matches a renamed TypeScript symbol and anchors its call edge", async () => {
        const diff = "@@ -1 +1 @@\n-export function loadUser(id: string) { return repository.find(id); }\n+export function fetchUser(id: string) { return repository.find(id); }";
        const result = await analyze({
            fileChanges: [{file: {path: "src/user-service.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/user-service.ts", status: "modified"}],
            chunks: [{
                id: "user-chunk",
                path: "src/user-service.ts",
                oldRange: {startLine: 1, endLine: 1},
                newRange: {startLine: 1, endLine: 1},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: "symbol-change",
                symbolMapping: expect.objectContaining({
                    status: "renamed",
                    base: expect.objectContaining({qualifiedName: "src.user-service.loadUser"}),
                    head: expect.objectContaining({qualifiedName: "src.user-service.fetchUser"}),
                }),
            }),
            expect.objectContaining({
                kind: "calls",
                target: "repository.find",
                sourceSymbol: expect.objectContaining({qualifiedName: "src.user-service.fetchUser"}),
                completeness: "unknown",
            }),
        ]));
        expect(result.limitations).not.toContain("symbol-identity-ambiguous");
    });

    it("tracks a symbol moved between TypeScript modules", async () => {
        const oldDiff = "@@ -1 +0,0 @@\n-export function execute(value: string) { return value; }";
        const newDiff = "@@ -0,0 +1 @@\n+export function execute(value: string) { return value; }";
        const result = await analyze({
            fileChanges: [{file: {path: "src/old.ts", status: "deleted"}, diff: oldDiff}, {
                file: {path: "src/new.ts", status: "added"}, diff: newDiff,
            }],
        }, {
            diff: "",
            files: [{path: "src/old.ts", status: "deleted"}, {path: "src/new.ts", status: "added"}],
            chunks: [{
                id: "old-chunk",
                path: "src/old.ts",
                oldRange: {startLine: 1, endLine: 1},
                content: oldDiff,
            }, {
                id: "new-chunk",
                path: "src/new.ts",
                newRange: {startLine: 1, endLine: 1},
                content: newDiff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toContainEqual(expect.objectContaining({
            changeAnchorId: "new-chunk",
            kind: "symbol-change",
            symbolMapping: expect.objectContaining({status: "moved"}),
        }));
    });

    it("keeps multiple move candidates ambiguous", async () => {
        const removed = (name: string) => ({
            file: {path: `src/${name}.ts`, status: "deleted" as const},
            diff: "@@ -1 +0,0 @@\n-export function execute(value: string) { return value; }",
        });
        const addedDiff = "@@ -0,0 +1 @@\n+export function execute(value: string) { return value; }";
        const result = await analyze({
            fileChanges: [removed("first"), removed("second"), {
                file: {path: "src/new.ts", status: "added"},
                diff: addedDiff,
            }],
        }, {
            diff: "",
            files: [],
            chunks: [{
                id: "new-chunk",
                path: "src/new.ts",
                newRange: {startLine: 1, endLine: 1},
                content: addedDiff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "symbol-change",
            completeness: "unknown",
            symbolMapping: expect.objectContaining({status: "ambiguous", candidates: expect.any(Array)}),
        }));
        expect(result.limitations).toContain("symbol-identity-ambiguous");
    });

    it("extracts Java implementation, inheritance, event, and persistence edges", async () => {
        const diff = [
            "@@ -0,0 +1,3 @@",
            "+public class UserHandler extends BaseHandler implements EventHandler {",
            "+  void handle(User user) { repository.save(user); events.publish(\"user.updated\", user); }",
            "+  Class<?> type = Class.forName(typeName);",
        ].join("\n");
        const result = await analyze({
            fileChanges: [{file: {path: "src/main/java/example/UserHandler.java", status: "added"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/main/java/example/UserHandler.java", status: "added"}],
            chunks: [{
                id: "java-symbol-chunk",
                path: "src/main/java/example/UserHandler.java",
                newRange: {startLine: 1, endLine: 3},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: "inherits", target: "BaseHandler"}),
            expect.objectContaining({kind: "implements", target: "EventHandler"}),
            expect.objectContaining({kind: "persists", target: "repository.save"}),
            expect.objectContaining({kind: "publishes", target: "user.updated"}),
        ]));
        expect(result.limitations).toEqual(expect.arrayContaining([
            "reflection-unavailable",
            "dynamic-dispatch-unavailable",
            "symbol-identity-unmatched",
        ]));
    });

    it("extracts a configuration key without copying its surrounding value", async () => {
        const diff = "@@ -0,0 +1 @@\n+const endpoint = process.env.SERVICE_URL ?? 'https://example.test';";
        const result = await analyze({
            fileChanges: [{file: {path: "src/config.ts", status: "added"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/config.ts", status: "added"}],
            chunks: [{
                id: "config-chunk",
                path: "src/config.ts",
                newRange: {startLine: 1, endLine: 1},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        });

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "configures",
            target: "SERVICE_URL",
        }));
    });
});
