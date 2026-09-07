import {createHash} from "node:crypto";
import {posix} from "node:path";
import * as ts from "@typescript/typescript6";
import {parser as javaParser} from "@lezer/java";
import type {StaticTestReference} from "../../domain/impact/model/impact-package.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";
import {createOpaqueTestAssetId} from "./test-asset-identity.js";

export type SupportedTestFramework = "vitest" | "jest" | "junit";

const typeScriptImport = /(?:import|export)\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gu;
const commonJsRequire = /require\(\s*["']([^"']+)["']\s*\)/gu;
const javaImport = /^\s*import\s+(?:static\s+)?([A-Za-z_$][\w.$]*);/gmu;

const opaqueReferenceId = (value: string): string =>
    `test-reference:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

const normalizeTypeScriptTarget = (testPath: string, target: string): string | undefined => {
    if (!target.startsWith(".")) {
        return undefined;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(testPath), target))
        .replace(/\.(?:[cm]?[jt]sx?)$/iu, "");
    return isSensitiveFile({path: `${resolved}.ts`, status: "modified"}) ? undefined : resolved;
};

const isSafeJavaTarget = (qualifiedName: string): boolean =>
    !isSensitiveFile({path: `${qualifiedName.replaceAll(".", "/")}.java`, status: "modified"});

const directTypeScriptCalls = (path: string, content: string): readonly string[] => {
    const parsedSourceFile = ts.createSourceFile(
        path,
        content,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const compilerOptions: ts.CompilerOptions = {noLib: true, noResolve: true, skipLibCheck: true};
    const host: ts.CompilerHost = {
        getSourceFile: (fileName) => fileName === path ? parsedSourceFile : undefined,
        getDefaultLibFileName: () => "",
        writeFile: () => undefined,
        getCurrentDirectory: () => "",
        getDirectories: () => [],
        fileExists: (fileName) => fileName === path,
        readFile: (fileName) => fileName === path ? content : undefined,
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
    };
    const program = ts.createProgram([path], compilerOptions, host);
    const sourceFile = program.getSourceFile(path);
    if (sourceFile === undefined) {
        return [];
    }
    const checker = program.getTypeChecker();
    type ImportedBinding = {target: string; declaration: ts.Declaration};
    const functions = new Map<string, ImportedBinding>();
    const namespaces = new Map<string, ImportedBinding>();
    const types = new Map<string, ImportedBinding>();
    const testFunctions = new Set<ts.Declaration>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (["vitest", "@jest/globals", "jest"].includes(statement.moduleSpecifier.text)
            && bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) {
                if (["it", "test"].includes(binding.propertyName?.text ?? binding.name.text)) {
                    testFunctions.add(binding);
                }
            }
        }
        const target = normalizeTypeScriptTarget(path, statement.moduleSpecifier.text);
        if (target === undefined) {
            continue;
        }
        const qualifier = target.replaceAll("/", ".");
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.set(bindings.name.text, {target: qualifier, declaration: bindings});
        } else if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) {
                const importedName = binding.propertyName?.text ?? binding.name.text;
                const imported = {target: `${qualifier}.${importedName}`, declaration: binding};
                functions.set(binding.name.text, imported);
                types.set(binding.name.text, imported);
            }
        }
    }
    const instanceTypes = new Map<string, {target: string; declaration: ts.VariableDeclaration}>();
    const collectInstances = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.initializer !== undefined
            && ts.isNewExpression(node.initializer)
            && ts.isIdentifier(node.initializer.expression)) {
            const type = types.get(node.initializer.expression.text);
            const symbol = checker.getSymbolAtLocation(node.initializer.expression);
            if (type !== undefined && symbol?.declarations?.includes(type.declaration) === true) {
                instanceTypes.set(node.name.text, {target: type.target, declaration: node});
            }
        }
        ts.forEachChild(node, collectInstances);
    };
    collectInstances(sourceFile);
    const isTestRegistration = (node: ts.CallExpression): boolean => ts.isIdentifier(node.expression)
        && checker.getSymbolAtLocation(node.expression)?.declarations?.some((declaration) =>
            testFunctions.has(declaration)) === true;
    const isInsideTestCallback = (node: ts.Node): boolean => {
        let current: ts.Node | undefined = node;
        while (current !== undefined && current !== sourceFile) {
            if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
                && ts.isCallExpression(current.parent)
                && current.parent.arguments.some((argument) => argument === current)
                && isTestRegistration(current.parent)) {
                return true;
            }
            current = current.parent;
        }
        return false;
    };
    const calls = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isInsideTestCallback(node)) {
            if (ts.isIdentifier(node.expression)) {
                const binding = functions.get(node.expression.text);
                const symbol = checker.getSymbolAtLocation(node.expression);
                if (binding !== undefined && symbol?.declarations?.includes(binding.declaration) === true) {
                    calls.add(binding.target);
                }
            } else if (ts.isPropertyAccessExpression(node.expression)) {
                const receiver = node.expression.expression;
                const member = node.expression.name.text;
                if (ts.isIdentifier(receiver)) {
                    const namespace = namespaces.get(receiver.text);
                    const importedType = types.get(receiver.text);
                    const instanceType = instanceTypes.get(receiver.text);
                    const symbol = checker.getSymbolAtLocation(receiver);
                    if (namespace !== undefined && symbol?.declarations?.includes(namespace.declaration) === true) {
                        calls.add(`${namespace.target}.${member}`);
                    }
                    if (importedType !== undefined && symbol?.declarations?.includes(importedType.declaration) === true) {
                        calls.add(`${importedType.target}#${member}`);
                    }
                    if (instanceType !== undefined && symbol?.declarations?.includes(instanceType.declaration) === true) {
                        calls.add(`${instanceType.target}#${member}`);
                    }
                } else if (ts.isNewExpression(receiver) && ts.isIdentifier(receiver.expression)) {
                    const type = types.get(receiver.expression.text);
                    const symbol = checker.getSymbolAtLocation(receiver.expression);
                    if (type !== undefined && symbol?.declarations?.includes(type.declaration) === true) {
                        calls.add(`${type.target}#${member}`);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return [...calls];
};

const directJavaCalls = (content: string): readonly string[] => {
    const importedTypes = new Map<string, string>();
    const importedMethods = new Map<string, string>();
    for (const match of content.matchAll(/^\s*import\s+(static\s+)?([A-Za-z_$][\w.$]*);/gmu)) {
        const qualifiedName = match[2];
        if (qualifiedName === undefined || !isSafeJavaTarget(qualifiedName)) {
            continue;
        }
        const segments = qualifiedName.split(".");
        const localName = segments.at(-1);
        if (localName === undefined) {
            continue;
        }
        if (match[1] === undefined) {
            importedTypes.set(localName, qualifiedName);
        } else if (segments.length > 1) {
            importedMethods.set(localName, `${segments.slice(0, -1).join(".")}#${localName}`);
        }
    }
    const instances = new Map<string, string>();
    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+\1\b/gu)) {
        const type = match[1] === undefined ? undefined : importedTypes.get(match[1]);
        if (type !== undefined && match[2] !== undefined) {
            instances.set(match[2], type);
        }
    }
    const calls = new Set<string>();
    const tree = javaParser.parse(content);
    const testMethodRanges: {from: number; to: number}[] = [];
    const methodCursor = tree.cursor();
    do {
        if (methodCursor.name === "MethodDeclaration"
            && /@(?:org\.junit\.jupiter\.api\.)?Test\b/u.test(content.slice(methodCursor.from, methodCursor.to))) {
            testMethodRanges.push({from: methodCursor.from, to: methodCursor.to});
        }
    } while (methodCursor.next());
    const cursor = tree.cursor();
    do {
        if (cursor.name !== "MethodInvocation"
            || !testMethodRanges.some((range) => cursor.from >= range.from && cursor.to <= range.to)) {
            continue;
        }
        const invocation = content.slice(cursor.from, cursor.to);
        const qualifiedCall = /^\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/u.exec(invocation);
        if (qualifiedCall !== null) {
            const owner = importedTypes.get(qualifiedCall[1]!) ?? instances.get(qualifiedCall[1]!);
            if (owner !== undefined) {
                calls.add(`${owner}#${qualifiedCall[2]}`);
            }
            continue;
        }
        const unqualifiedCall = /^\s*([A-Za-z_$][\w$]*)\s*\(/u.exec(invocation);
        const target = unqualifiedCall === null ? undefined : importedMethods.get(unqualifiedCall[1]!);
        if (target !== undefined) {
            calls.add(target);
        }
    } while (cursor.next());
    return [...calls];
};

/** 从一个已提交测试文件提取受限的静态 import 与直接符号调用，不返回测试路径或正文。 */
export const extractTestReferences = (
    path: string,
    content: string,
    framework: SupportedTestFramework,
    sourceRevision: string,
): readonly StaticTestReference[] => {
    const testId = createOpaqueTestAssetId(path);
    const targets = new Set<string>();
    const kind = framework === "junit" ? "java-import" as const : "module-import" as const;
    if (kind === "java-import") {
        for (const match of content.matchAll(javaImport)) {
            if (match[1] !== undefined && isSafeJavaTarget(match[1])) {
                targets.add(match[1]);
            }
        }
    } else {
        for (const pattern of [typeScriptImport, commonJsRequire]) {
            for (const match of content.matchAll(pattern)) {
                const target = normalizeTypeScriptTarget(path, match[1]!);
                if (target !== undefined) {
                    targets.add(target);
                }
            }
        }
    }
    const imports: StaticTestReference[] = [...targets].map((target) => ({
        id: opaqueReferenceId(`${testId}:${kind}:${target}`),
        testId,
        target,
        kind,
        framework,
        sourceRevision,
        association: "direct-static-import",
    }));
    const callKind = framework === "junit" ? "java-symbol-call" as const : "typescript-symbol-call" as const;
    const calls = framework === "junit" ? directJavaCalls(content) : directTypeScriptCalls(path, content);
    return [...imports, ...calls.map((target): StaticTestReference => ({
        id: opaqueReferenceId(`${testId}:${callKind}:${target}`),
        testId,
        target,
        kind: callKind,
        framework,
        sourceRevision,
        association: "direct-symbol-call",
    }))];
};
