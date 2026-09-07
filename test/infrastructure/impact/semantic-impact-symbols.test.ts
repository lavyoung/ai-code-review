import {describe, expect, it} from "vitest";
import {ChangedImportSemanticImpactIndex} from "../../../src/infrastructure/impact/changed-import-semantic-impact-index.js";
import type {CodeChange, RawCodeChange} from "../../../src/domain/review/model/code-change.js";

const analyze = async (rawCodeChange: RawCodeChange, codeChange: CodeChange) =>
    new ChangedImportSemanticImpactIndex().analyze(rawCodeChange, codeChange, AbortSignal.timeout(1_000));

describe("semantic impact symbol identity", () => {
    it("uses the committed TypeScript program to infer an identifier returned by a local function", async () => {
        const diff = "@@ -2 +2 @@\n-export declare function parse(value: number): string;\n+export declare function parse(value: number): number;";
        const base = "export declare function parse(value: string): string;\nexport declare function parse(value: number): string;\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                typeScriptConfiguration: {path: "tsconfig.json" as const, content: "{\"compilerOptions\":{\"strict\":true}}"},
                files: revision === "base" ? [{path: "src/parser.ts", language: "typescript" as const, content: base}] : [{
                    path: "src/parser.ts", language: "typescript" as const, content: base.replace("number): string", "number): number"),
                }, {
                    path: "src/program-consumer.ts",
                    language: "typescript" as const,
                    content: "import {parse} from './parser.js';\nfunction input(): number { return 1; }\nconst value = input();\nparse(value);\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/parser.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/parser.ts", status: "modified"}],
            chunks: [{id: "program-type-chunk", path: "src/parser.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/program-consumer.ts",
            targetSymbol: expect.objectContaining({signature: "(number)"}),
        }));
    });

    it("merges a committed relative tsconfig extends chain for type resolution", async () => {
        const diff = "@@ -2 +2 @@\n-export declare function parse(value: null): string;\n+export declare function parse(value: null): number;";
        const base = "export declare function parse(value: string): string;\nexport declare function parse(value: null): string;\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                typeScriptConfiguration: {
                    path: "tsconfig.json" as const,
                    content: "{\"extends\":\"./config/strict.json\"}",
                    extendedConfigurations: [{
                        path: "config/strict.json",
                        content: "{\"compilerOptions\":{\"strictNullChecks\":true}}",
                    }],
                },
                files: revision === "base" ? [{path: "src/parser.ts", language: "typescript" as const, content: base}] : [{
                    path: "src/parser.ts", language: "typescript" as const, content: base.replace("null): string", "null): number"),
                }, {
                    path: "src/config-consumer.ts",
                    language: "typescript" as const,
                    content: "import {parse} from './parser.js';\nfunction input() { return null; }\nparse(input());\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/parser.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/parser.ts", status: "modified"}],
            chunks: [{id: "extended-config-chunk", path: "src/parser.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).not.toContain("typescript-configuration-unavailable");
        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/config-consumer.ts",
            targetSymbol: expect.objectContaining({signature: "(null)"}),
        }));
    });

    it("degrades a cyclic committed tsconfig extends chain without losing syntax relations", async () => {
        const diff = "@@ -1 +1 @@\n-export function convert() { return 1; }\n+export function convert() { return 2; }";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                typeScriptConfiguration: {
                    path: "tsconfig.json" as const,
                    content: "{\"extends\":\"./config/base.json\"}",
                    extendedConfigurations: [{
                        path: "config/base.json",
                        content: "{\"extends\":\"../tsconfig.json\"}",
                    }],
                },
                files: [{
                    path: "src/converter.ts",
                    language: "typescript" as const,
                    content: revision === "base" ? "export function convert() { return 1; }" : "export function convert() { return 2; }",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "cyclic-config-chunk", path: "src/converter.ts", oldRange: {startLine: 1, endLine: 1}, newRange: {startLine: 1, endLine: 1}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toContain("typescript-configuration-unavailable");
        expect(result.relations).toContainEqual(expect.objectContaining({kind: "symbol-change"}));
    });

    it.each([{
        name: "missing parent",
        root: "{\"extends\":\"./config/missing.json\"}",
        extendedConfigurations: [],
    }, {
        name: "repository escape",
        root: "{\"extends\":\"../outside.json\"}",
        extendedConfigurations: [],
    }, {
        name: "node_modules parent",
        root: "{\"extends\":\"./node_modules/shared/tsconfig.json\"}",
        extendedConfigurations: [{
            path: "node_modules/shared/tsconfig.json",
            content: "{\"compilerOptions\":{\"strict\":true}}",
        }],
    }, {
        name: "project references",
        root: "{\"references\":[{\"path\":\"./packages/core\"}]}",
        extendedConfigurations: [],
    }, {
        name: "extends depth overflow",
        root: "{\"extends\":\"./config/level-1.json\"}",
        extendedConfigurations: [1, 2, 3, 4].map((level) => ({
            path: `config/level-${level}.json`,
            content: `{\"extends\":\"./level-${level + 1}.json\"}`,
        })),
    }])("degrades $name TypeScript configuration without losing syntax relations", async ({
        root,
        extendedConfigurations,
    }) => {
        const diff = "@@ -1 +1 @@\n-export function convert() { return 1; }\n+export function convert() { return 2; }";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                typeScriptConfiguration: {
                    path: "tsconfig.json" as const,
                    content: root,
                    extendedConfigurations,
                },
                files: [{
                    path: "src/converter.ts",
                    language: "typescript" as const,
                    content: revision === "base" ? "export function convert() { return 1; }" : "export function convert() { return 2; }",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "unavailable-config-chunk", path: "src/converter.ts", oldRange: {startLine: 1, endLine: 1}, newRange: {startLine: 1, endLine: 1}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toContain("typescript-configuration-unavailable");
        expect(result.relations).toContainEqual(expect.objectContaining({kind: "symbol-change"}));
    });

    it("degrades an invalid committed TypeScript configuration without losing syntax relations", async () => {
        const diff = "@@ -1 +1 @@\n-export function convert() { return 1; }\n+export function convert() { return 2; }";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                typeScriptConfiguration: {path: "tsconfig.json" as const, content: "{"},
                files: [{
                    path: "src/converter.ts",
                    language: "typescript" as const,
                    content: revision === "base" ? "export function convert() { return 1; }" : "export function convert() { return 2; }",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "invalid-config-chunk", path: "src/converter.ts", oldRange: {startLine: 1, endLine: 1}, newRange: {startLine: 1, endLine: 1}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toContain("typescript-configuration-unavailable");
        expect(result.relations).toContainEqual(expect.objectContaining({kind: "symbol-change"}));
    });

    it("links a Java derived instance call to an inherited changed method", async () => {
        const diff = "@@ -4 +4 @@\n-    oldStore(user);\n+    newStore(user);";
        const baseService = "package service;\npublic class UserService {\n  public void save(User user) {\n    oldStore(user);\n  }\n}\n";
        const headService = baseService.replace("oldStore(user)", "newStore(user)");
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/main/java/service/UserService.java", language: "java" as const, content: baseService,
                }] : [{
                    path: "src/main/java/service/UserService.java", language: "java" as const, content: headService,
                }, {
                    path: "src/main/java/service/ManagedUserService.java",
                    language: "java" as const,
                    content: "package service;\npublic class ManagedUserService extends UserService {}\n",
                }, {
                    path: "src/main/java/api/UserController.java",
                    language: "java" as const,
                    content: "package api;\nimport service.ManagedUserService;\nclass UserController {\n  ManagedUserService service;\n  void handle(User user) { service.save(user); }\n}\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/main/java/service/UserService.java", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/main/java/service/UserService.java", status: "modified"}],
            chunks: [{id: "java-inherited-call", path: "src/main/java/service/UserService.java", oldRange: {startLine: 4, endLine: 4}, newRange: {startLine: 4, endLine: 4}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/main/java/api/UserController.java",
            targetSymbol: expect.objectContaining({qualifiedName: "service.UserService#save"}),
        }));
    });

    it("resolves a one-hop aliased TypeScript barrel re-export", async () => {
        const diff = "@@ -2 +2 @@\n-  return oldValue;\n+  return newValue;";
        const base = "export function convert() {\n  return oldValue;\n}\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/converter.ts", language: "typescript" as const, content: base,
                }] : [{
                    path: "src/converter.ts", language: "typescript" as const, content: base.replace("oldValue", "newValue"),
                }, {
                    path: "src/internal-index.ts",
                    language: "typescript" as const,
                    content: "export {convert as parse} from './converter.js';\n",
                }, {
                    path: "src/public-index.ts",
                    language: "typescript" as const,
                    content: "export {parse as publicParse} from './internal-index.js';\n",
                }, {
                    path: "src/barrel-consumer.ts",
                    language: "typescript" as const,
                    content: "import {publicParse as parseValue} from './public-index.js';\nparseValue();\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "barrel-chunk", path: "src/converter.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/barrel-consumer.ts",
            targetSymbol: expect.objectContaining({qualifiedName: "src.converter.convert"}),
        }));
    });

    it("detects a TypeScript barrel cycle without inventing a call relation", async () => {
        const diff = "@@ -2 +2 @@\n-  return oldValue;\n+  return newValue;";
        const base = "export function convert() {\n  return oldValue;\n}\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{path: "src/converter.ts", language: "typescript" as const, content: base}] : [{
                    path: "src/converter.ts", language: "typescript" as const, content: base.replace("oldValue", "newValue"),
                }, {
                    path: "src/a.ts", language: "typescript" as const, content: "export * from './b.js';\n",
                }, {
                    path: "src/b.ts", language: "typescript" as const, content: "export * from './a.js';\n",
                }, {
                    path: "src/cycle-consumer.ts", language: "typescript" as const, content: "import {convert} from './a.js';\nconvert();\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "cycle-chunk", path: "src/converter.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.limitations).toContain("barrel-cycle-unavailable");
        expect(result.relations).not.toContainEqual(expect.objectContaining({sourcePath: "src/cycle-consumer.ts"}));
    });

    it("resolves a TypeScript class instance method through an imported type alias", async () => {
        const diff = "@@ -3 +3 @@\n-    return oldRun(value);\n+    return newRun(value);";
        const base = "export class Service {\n  run(value: string) {\n    return oldRun(value);\n  }\n}\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/service.ts", language: "typescript" as const, content: base,
                }] : [{
                    path: "src/service.ts", language: "typescript" as const, content: base.replace("oldRun", "newRun"),
                }, {
                    path: "src/derived-service.ts",
                    language: "typescript" as const,
                    content: "import {Service as BaseService} from './service.js';\nexport class DerivedService extends BaseService {}\n",
                }, {
                    path: "src/final-service.ts",
                    language: "typescript" as const,
                    content: "import {DerivedService} from './derived-service.js';\nexport class FinalService extends DerivedService {}\n",
                }, {
                    path: "src/consumer.ts",
                    language: "typescript" as const,
                    content: "import {FinalService as Engine} from './final-service.js';\nexport function consume(engine: Engine) {\n  return engine.run('value');\n}\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/service.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/service.ts", status: "modified"}],
            chunks: [{id: "method-chunk", path: "src/service.ts", oldRange: {startLine: 3, endLine: 3}, newRange: {startLine: 3, endLine: 3}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/consumer.ts",
            targetSymbol: expect.objectContaining({qualifiedName: "src.service.Service#run"}),
        }));
    });

    it("uses literal types to resolve same-arity TypeScript overloads", async () => {
        const diff = "@@ -2 +2 @@\n-export declare function parse(value: number): string;\n+export declare function parse(value: number): number;";
        const base = "export declare function parse(value: string): string;\nexport declare function parse(value: number): string;\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{path: "src/parser.ts", language: "typescript" as const, content: base}] : [{
                    path: "src/parser.ts", language: "typescript" as const, content: base.replace("number): string", "number): number"),
                }, {
                    path: "src/string-consumer.ts", language: "typescript" as const, content: "import {parse} from './parser.js';\nparse('1');\n",
                }, {
                    path: "src/number-consumer.ts", language: "typescript" as const, content: "import {parse} from './parser.js';\nconst value: number = 1;\nparse(value);\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/parser.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/parser.ts", status: "modified"}],
            chunks: [{id: "typed-overload-chunk", path: "src/parser.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        const callers = result.relations
            .filter((relation) => relation.kind === "calls" && relation.targetSymbol?.qualifiedName === "src.parser.parse")
            .map((relation) => relation.sourcePath);
        expect(callers).toContain("src/number-consumer.ts");
        expect(callers).not.toContain("src/string-consumer.ts");
    });

    it("resolves an aliased TypeScript default import", async () => {
        const diff = "@@ -2 +2 @@\n-  return oldValue;\n+  return newValue;";
        const base = "export default function convert() {\n  return oldValue;\n}\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/converter.ts", language: "typescript" as const, content: base,
                }] : [{
                    path: "src/converter.ts", language: "typescript" as const, content: base.replace("oldValue", "newValue"),
                }, {
                    path: "src/default-consumer.ts",
                    language: "typescript" as const,
                    content: "import convertAlias from './converter.js';\nconvertAlias();\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{id: "default-chunk", path: "src/converter.ts", oldRange: {startLine: 2, endLine: 2}, newRange: {startLine: 2, endLine: 2}, content: diff}],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/default-consumer.ts",
            targetSymbol: expect.objectContaining({qualifiedName: "src.converter.convert"}),
        }));
    });

    it("uses call arity to avoid linking a changed TypeScript overload to another overload", async () => {
        const diff = "@@ -2 +2 @@\n-export declare function convert(value: string, radix: number): string;\n+export declare function convert(value: string, radix: number): number;";
        const baseFile = {
            path: "src/converter.ts",
            language: "typescript" as const,
            content: "export declare function convert(value: string): string;\nexport declare function convert(value: string, radix: number): string;\n",
        };
        const headFile = {...baseFile, content: baseFile.content.replace("radix: number): string", "radix: number): number")};
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [baseFile] : [headFile, {
                    path: "src/one-argument.ts",
                    language: "typescript" as const,
                    content: "import {convert} from './converter.js';\nconvert('10');\n",
                }, {
                    path: "src/two-arguments.ts",
                    language: "typescript" as const,
                    content: "import {convert} from './converter.js';\nconvert('10', 10);\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{
                id: "overload-chunk",
                path: "src/converter.ts",
                oldRange: {startLine: 2, endLine: 2},
                newRange: {startLine: 2, endLine: 2},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        const callers = result.relations
            .filter((relation) => relation.kind === "calls" && relation.targetSymbol !== undefined)
            .map((relation) => relation.sourcePath);
        expect(callers).toContain("src/two-arguments.ts");
        expect(callers).not.toContain("src/one-argument.ts");
    });

    it("resolves TypeScript named and namespace import aliases with the AST", async () => {
        const diff = "@@ -2 +2 @@\n-  return oldNormalizer(value);\n+  return newNormalizer(value);";
        const baseFile = {
            path: "src/converter.ts",
            language: "typescript" as const,
            content: "export function convert(value: string) {\n  return oldNormalizer(value);\n}\n",
        };
        const headFile = {...baseFile, content: "export function convert(value: string) {\n  return newNormalizer(value);\n}\n"};
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [baseFile] : [headFile, {
                    path: "src/named-consumer.ts",
                    language: "typescript" as const,
                    content: "import {convert as convertValue} from './converter.js';\nconvertValue('x');\n",
                }, {
                    path: "src/namespace-consumer.ts",
                    language: "typescript" as const,
                    content: "import * as converter from './converter.js';\nconverter.convert('x');\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{
                id: "alias-chunk",
                path: "src/converter.ts",
                oldRange: {startLine: 2, endLine: 2},
                newRange: {startLine: 2, endLine: 2},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        const callerPaths = result.relations
            .filter((relation) => relation.kind === "calls" && relation.targetSymbol?.qualifiedName === "src.converter.convert")
            .map((relation) => relation.sourcePath);
        expect(callerPaths).toEqual(expect.arrayContaining(["src/named-consumer.ts", "src/namespace-consumer.ts"]));
    });

    it("resolves a Java instance call through an imported field type", async () => {
        const diff = "@@ -4 +4 @@\n-    oldStore(user);\n+    newStore(user);";
        const baseService = "package service;\npublic class UserService {\n  public void save(User user) {\n    oldStore(user);\n  }\n}\n";
        const headService = baseService.replace("oldStore(user)", "newStore(user)");
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/main/java/service/UserService.java",
                    language: "java" as const,
                    content: baseService,
                }] : [{
                    path: "src/main/java/service/UserService.java",
                    language: "java" as const,
                    content: headService,
                }, {
                    path: "src/main/java/api/UserController.java",
                    language: "java" as const,
                    content: "package api;\nimport service.*;\npublic class UserController {\n  private final UserService service;\n  void handle(User user) { service.save(user); }\n}\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/main/java/service/UserService.java", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/main/java/service/UserService.java", status: "modified"}],
            chunks: [{
                id: "java-call-chunk",
                path: "src/main/java/service/UserService.java",
                oldRange: {startLine: 4, endLine: 4},
                newRange: {startLine: 4, endLine: 4},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toContainEqual(expect.objectContaining({
            kind: "calls",
            sourcePath: "src/main/java/api/UserController.java",
            targetSymbol: expect.objectContaining({qualifiedName: "service.UserService#save"}),
            completeness: "partial",
        }));
    });

    it("resolves Java cross-package inheritance targets", async () => {
        const diff = "@@ -3 +3 @@\n-public class Handler {\n+public class Handler extends BaseHandler<String> implements Contract<Map<String, User>> {";
        const baseHandler = "package app;\npublic class Handler {\n}\n";
        const headHandler = "package app;\nimport base.BaseHandler;\nimport api.Contract;\npublic class Handler extends BaseHandler<String> implements Contract<Map<String, User>> {\n}\n";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/main/java/app/Handler.java",
                    language: "java" as const,
                    content: baseHandler,
                }] : [{
                    path: "src/main/java/app/Handler.java",
                    language: "java" as const,
                    content: headHandler,
                }, {
                    path: "src/main/java/base/BaseHandler.java",
                    language: "java" as const,
                    content: "package base;\npublic class BaseHandler {}\n",
                }, {
                    path: "src/main/java/api/Contract.java",
                    language: "java" as const,
                    content: "package api;\npublic interface Contract {}\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/main/java/app/Handler.java", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/main/java/app/Handler.java", status: "modified"}],
            chunks: [{
                id: "inheritance-chunk",
                path: "src/main/java/app/Handler.java",
                oldRange: {startLine: 3, endLine: 3},
                newRange: {startLine: 3, endLine: 3},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: "inherits", targetSymbol: expect.objectContaining({qualifiedName: "base.BaseHandler"})}),
            expect.objectContaining({kind: "implements", targetSymbol: expect.objectContaining({qualifiedName: "api.Contract"})}),
        ]));
    });

    it("uses committed snapshots to anchor an implementation change and find an unchanged caller", async () => {
        const diff = "@@ -2 +2 @@\n-  return oldNormalizer(value);\n+  return newNormalizer(value);";
        const revisionSource = {
            read: async (_range: unknown, revision: "base" | "head") => ({
                status: "available" as const,
                files: revision === "base" ? [{
                    path: "src/converter.ts",
                    language: "typescript" as const,
                    content: "export function convert(value: string) {\n  return oldNormalizer(value);\n}\n",
                }] : [{
                    path: "src/converter.ts",
                    language: "typescript" as const,
                    content: "export function convert(value: string) {\n  return newNormalizer(value);\n}\n",
                }, {
                    path: "src/consumer.ts",
                    language: "typescript" as const,
                    content: "import {convert} from './converter.js';\nexport function consume() {\n  return convert('value');\n}\n",
                }],
            }),
        };
        const result = await new ChangedImportSemanticImpactIndex(revisionSource).analyze({
            revisionRange: {baseRef: "base", headRef: "head", comparison: "two-dot"},
            fileChanges: [{file: {path: "src/converter.ts", status: "modified"}, diff}],
        }, {
            diff: "",
            files: [{path: "src/converter.ts", status: "modified"}],
            chunks: [{
                id: "implementation-chunk",
                path: "src/converter.ts",
                oldRange: {startLine: 2, endLine: 2},
                newRange: {startLine: 2, endLine: 2},
                content: diff,
            }],
            excludedFileCount: 0,
            redactedValueCount: 0,
        }, AbortSignal.timeout(1_000));

        expect(result.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: "symbol-change",
                changeAnchorId: "implementation-chunk",
                symbolMapping: expect.objectContaining({status: "implementation-replaced"}),
            }),
            expect.objectContaining({
                kind: "calls",
                sourcePath: "src/consumer.ts",
                sourceLine: 3,
                target: "src.converter.convert",
                completeness: "partial",
                targetSymbol: expect.objectContaining({qualifiedName: "src.converter.convert"}),
            }),
        ]));
    });

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
