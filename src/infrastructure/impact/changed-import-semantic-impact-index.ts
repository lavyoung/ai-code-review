import {createHash} from "node:crypto";
import {posix as pathTools} from "node:path";
import * as ts from "@typescript/typescript6";
import {parser as javaParser} from "@lezer/java";
import type {CodeChange, DiffChunk, RawCodeChange} from "../../domain/review/model/code-change.js";
import type {
    ImpactPackage,
    ImpactRelationKind,
    StaticImpactRelation,
    SymbolIdentity,
    SymbolIdentityMapping,
} from "../../domain/impact/model/impact-package.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../domain/review/policy/sensitive-content-policy.js";
import type {
    SemanticImpactIndexPort,
    SemanticImpactIndexResult,
} from "../../application/review/ports/semantic-impact-index-port.js";
import type {
    CommittedRevisionSourcePort,
    CommittedSourceFile,
} from "../../application/review/ports/committed-revision-source-port.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
const typeScriptImport = /^\s*(?:import|export)\s+(?:.+?\s+from\s+)?["']([^"']+)["']/u;
const commonJsRequire = /\brequire\(\s*["']([^"']+)["']\s*\)/u;
const javaImport = /^\s*import\s+(?:static\s+)?([A-Za-z_$][\w.$]*(?:\.\*)?);/u;
const testPath = /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu;
const unsupportedDynamicDependency = /\bimport\s*\((?!\s*["'])|\brequire\s*\((?!\s*["'])/u;
const reflectionUsage = /\bReflect\.|\bProxy\s*\(|\bClass\.forName\s*\(|\.getDeclaredMethod\s*\(|\.getMethod\s*\(|java\.lang\.reflect/u;
const generatedSource = /(?:^|\/)(?:generated|generated-sources|build\/generated|target\/generated-sources)(?:\/|$)|@Generated\b|\bcodegen\b/iu;
const callKeywords = new Set(["if", "for", "while", "switch", "catch", "return", "new", "typeof", "super", "this"]);

type Language = SymbolIdentity["language"];
type Revision = "base" | "head";

interface DiffLine {
    revision: Revision;
    line: number;
    content: string;
}

interface SymbolCandidate {
    identity: SymbolIdentity;
    revision: Revision;
    path: string;
    line: number;
    name: string;
    shapeDigest: string;
    isDefaultExport: boolean;
}

const digest = (value: string, length = 16): string =>
    createHash("sha256").update(value).digest("hex").slice(0, length);

const relationId = (chunkId: string, kind: ImpactRelationKind, line: number, target: string): string =>
    `relation:${digest(`${chunkId}:${kind}:${line}:${target}`)}`;

const toSafeTarget = (target: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(target).content).slice(0, 256);

const canonicalPath = (path: string): string => path.replaceAll("\\", "/");

const moduleQualifier = (path: string, language: Language): string => {
    const normalized = canonicalPath(path)
        .replace(/\.(?:[cm]?[jt]sx?|java)$/iu, "")
        .replace(/^\.\//u, "");
    return (language === "java"
        ? normalized.replace(/^(?:.*\/)?src\/(?:main|test)\/java\//u, "")
        : normalized).replaceAll("/", ".");
};

const parseChangedLines = (diff: string): DiffLine[] => {
    const result: DiffLine[] = [];
    let oldLine: number | undefined;
    let newLine: number | undefined;
    for (const rawLine of diff.split("\n")) {
        const header = HUNK_HEADER.exec(rawLine);
        if (header !== null) {
            oldLine = Number(header[1]);
            newLine = Number(header[2]);
            continue;
        }
        if (oldLine === undefined || newLine === undefined || rawLine.startsWith("\\ No newline")) {
            continue;
        }
        if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
            result.push({revision: "head", line: newLine, content: rawLine.slice(1)});
            newLine += 1;
            continue;
        }
        if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
            result.push({revision: "base", line: oldLine, content: rawLine.slice(1)});
            oldLine += 1;
            continue;
        }
        if (rawLine.startsWith(" ")) {
            oldLine += 1;
            newLine += 1;
        }
    }
    return result;
};

const sourceLines = (content: string, revision: Revision): DiffLine[] => content.split(/\r?\n/u)
    .map((line, index) => ({revision, line: index + 1, content: line}));

const normalizeParameters = (parameters: string, language: Language): string => {
    if (parameters.trim() === "") {
        return "()";
    }
    const types = parameters.split(",").map((parameter) => {
        const normalized = parameter
            .replace(/@[A-Za-z_$][\w.$]*(?:\([^)]*\))?/gu, "")
            .replace(/\b(?:final|readonly|public|private|protected)\b/gu, "")
            .trim();
        if (language === "typescript") {
            return normalized.split(":")[1]?.split("=")[0]?.trim() ?? "unknown";
        }
        const tokens = normalized.replace(/\s*=.*$/u, "").split(/\s+/u);
        return tokens.length > 1 ? tokens.slice(0, -1).join(" ") : "unknown";
    });
    return `(${types.join(",")})`;
};

const createSymbolIdentity = (
    language: Language,
    qualifiedName: string,
    signature: string | undefined,
    source: string,
): SymbolIdentity => ({
    language,
    qualifiedName,
    ...(signature === undefined ? {} : {signature}),
    sourceDigest: digest(source.replace(/\s+/gu, " ").trim(), 24),
    stableId: `symbol:${digest(`${language}:${qualifiedName}:${signature ?? ""}`, 24)}`,
});

const extractSymbols = (
    path: string,
    language: Language,
    lines: readonly DiffLine[],
    previousPath?: string,
    includeFollowingSource = false,
): SymbolCandidate[] => {
    const packageName = language === "java"
        ? lines.map((line) => /^\s*package\s+([\w.]+)\s*;/u.exec(line.content)?.[1]).find((value) => value !== undefined)
        : undefined;
    const candidates: SymbolCandidate[] = [];
    for (const line of lines) {
        const content = line.content.trim();
        const identityPath = line.revision === "base" ? previousPath ?? path : path;
        const qualifier = moduleQualifier(identityPath, language);
        const typeDeclaration = language === "typescript"
            ? /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/u.exec(content)
            : /^(?:(?:public|protected|private|abstract|final|sealed|non-sealed|static)\s+)*(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/u.exec(content);
        let name: string | undefined;
        let signature: string | undefined;
        if (typeDeclaration !== null) {
            name = typeDeclaration[2];
            signature = typeDeclaration[1];
        } else if (language === "typescript") {
            const declaration = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/u.exec(content)
                ?? /^(?:(?:public|protected|private|static|abstract|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::|\{|=>|;)/u.exec(content);
            name = declaration?.[1];
            signature = declaration === null ? undefined : normalizeParameters(declaration[2] ?? "", language);
        } else {
            const declaration = /^(?:(?:public|protected|private|static|abstract|final|synchronized|native|default)\s+)*(?:<[^>]+>\s+)?[A-Za-z_$][\w.$<>?, \[\]]*\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{;]+)?[\{;]/u.exec(content);
            name = declaration?.[1];
            signature = declaration === null ? undefined : normalizeParameters(declaration[2] ?? "", language);
        }
        if (name === undefined) {
            continue;
        }
        if (callKeywords.has(name)) {
            continue;
        }
        const isTypeDeclaration = typeDeclaration !== null;
        const javaOwner = canonicalPath(identityPath).split("/").at(-1)?.replace(/\.java$/iu, "");
        const qualifiedName = language === "java"
            ? isTypeDeclaration
                ? `${packageName === undefined ? qualifier.split(".").slice(0, -1).join(".") : packageName}.${name}`
                : `${packageName === undefined ? qualifier : `${packageName}.${javaOwner ?? "unknown"}`}#${name}`
            : `${qualifier}.${name}`;
        const identity = createSymbolIdentity(language, qualifiedName, signature, content);
        candidates.push({
            identity,
            revision: line.revision,
            path,
            line: line.line,
            name,
            shapeDigest: digest(content.replace(new RegExp(`\\b${name}\\b`, "gu"), "$symbol").replace(/\s+/gu, " ")),
            isDefaultExport: language === "typescript" && /^export\s+default\b/u.test(content),
        });
    }
    if (!includeFollowingSource) {
        return candidates;
    }
    return candidates.map((candidate) => {
        const nextLine = candidates
            .filter((other) => other.revision === candidate.revision && other.line > candidate.line)
            .sort((left, right) => left.line - right.line)[0]?.line ?? Number.POSITIVE_INFINITY;
        const source = lines
            .filter((line) => line.revision === candidate.revision && line.line >= candidate.line && line.line < nextLine)
            .map((line) => line.content)
            .join("\n");
        return {
            ...candidate,
            identity: {
                ...candidate.identity,
                sourceDigest: digest(source.replace(/\s+/gu, " ").trim(), 24),
            },
            shapeDigest: digest(source.replace(new RegExp(`\\b${candidate.name}\\b`, "gu"), "$symbol").replace(/\s+/gu, " ")),
        };
    });
};

const matchCandidates = (
    baseSymbols: readonly SymbolCandidate[],
    headSymbols: readonly SymbolCandidate[],
): {candidate: SymbolCandidate; mapping: SymbolIdentityMapping}[] => {
    const mappings: {candidate: SymbolCandidate; mapping: SymbolIdentityMapping}[] = [];
    const usedBaseIds = new Set<string>();
    for (const head of headSymbols) {
        const tiers: {status: SymbolIdentityMapping["status"]; matches: SymbolCandidate[]}[] = [{
            status: "implementation-replaced",
            matches: baseSymbols.filter((base) => base.identity.language === head.identity.language
                && base.identity.qualifiedName === head.identity.qualifiedName
                && base.identity.signature === head.identity.signature),
        }, {
            status: "moved",
            matches: baseSymbols.filter((base) => base.identity.language === head.identity.language
                && base.name === head.name
                && base.identity.signature === head.identity.signature
                && base.shapeDigest === head.shapeDigest
                && base.identity.qualifiedName !== head.identity.qualifiedName),
        }, {
            status: "renamed",
            matches: baseSymbols.filter((base) => base.identity.language === head.identity.language
                && base.name !== head.name
                && base.identity.signature === head.identity.signature
                && base.shapeDigest === head.shapeDigest),
        }, {
            status: "overload-changed",
            matches: baseSymbols.filter((base) => base.identity.language === head.identity.language
                && base.identity.qualifiedName === head.identity.qualifiedName
                && base.identity.signature !== head.identity.signature),
        }];
        const tier = tiers.find((entry) => entry.matches.length > 0);
        if (tier === undefined) {
            mappings.push({candidate: head, mapping: {status: "unmatched", head: head.identity}});
            continue;
        }
        if (tier.matches.length > 1) {
            mappings.push({
                candidate: head,
                mapping: {status: "ambiguous", head: head.identity, candidates: tier.matches.map((match) => match.identity)},
            });
            continue;
        }
        const base = tier.matches[0];
        if (base === undefined) {
            continue;
        }
        usedBaseIds.add(base.identity.stableId);
        const status = tier.status === "implementation-replaced" && base.identity.sourceDigest === head.identity.sourceDigest
            ? "matched"
            : tier.status;
        mappings.push({candidate: head, mapping: {status, base: base.identity, head: head.identity}});
    }
    for (const base of baseSymbols.filter((candidate) => !usedBaseIds.has(candidate.identity.stableId))) {
        mappings.push({candidate: base, mapping: {status: "unmatched", base: base.identity}});
    }
    return mappings;
};

const locateAnchor = (
    chunks: readonly DiffChunk[],
    path: string,
    line: number,
    revision: Revision,
): DiffChunk | undefined => chunks.find((chunk) => {
    if (chunk.path !== path) {
        return false;
    }
    const range = revision === "head" ? chunk.newRange : chunk.oldRange;
    return range !== undefined && line >= range.startLine && line <= range.endLine;
});

const findNearestSourceSymbol = (
    symbols: readonly SymbolCandidate[],
    path: string,
    line: number,
): SymbolIdentity | undefined => [...symbols]
    .filter((symbol) => symbol.revision === "head" && symbol.path === path && symbol.line <= line)
    .sort((left, right) => right.line - left.line)[0]?.identity;

const findNearestSymbolCandidate = (
    symbols: readonly SymbolCandidate[],
    path: string,
    line: number,
    revision: Revision,
): SymbolCandidate | undefined => [...symbols]
    .filter((symbol) => symbol.revision === revision && symbol.path === path && symbol.line <= line)
    .sort((left, right) => right.line - left.line)[0];

const selectChangedSymbols = (
    repositorySymbols: readonly SymbolCandidate[],
    parsedFiles: readonly {path: string; language: Language; lines: DiffLine[]}[],
): SymbolCandidate[] => {
    const selected = new Map<string, SymbolCandidate>();
    for (const file of parsedFiles) {
        for (const line of file.lines) {
            const symbol = findNearestSymbolCandidate(repositorySymbols, file.path, line.line, line.revision);
            if (symbol === undefined) {
                continue;
            }
            const anchored = {...symbol, line: line.line};
            selected.set(`${symbol.revision}:${symbol.identity.stableId}`, anchored);
        }
    }
    return [...selected.values()];
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const symbolName = (symbol: SymbolIdentity): string => {
    const methodSeparator = symbol.qualifiedName.lastIndexOf("#");
    return symbol.qualifiedName.slice(methodSeparator >= 0 ? methodSeparator + 1 : symbol.qualifiedName.lastIndexOf(".") + 1);
};

interface LocatedCall {
    line: number;
    argumentCount: number;
}

const matchesTypeScriptModule = (callerPath: string, moduleReference: string, targetPath: string): boolean => {
    if (!moduleReference.startsWith(".")) {
        return false;
    }
    const importedModule = pathTools.normalize(pathTools.join(pathTools.dirname(callerPath), moduleReference))
        .replace(/\.(?:[cm]?[jt]sx?|js)$/iu, "");
    const targetModule = canonicalPath(targetPath).replace(/\.(?:[cm]?[jt]sx?)$/iu, "");
    return importedModule === targetModule || `${importedModule}/index` === targetModule;
};

const findImportedTypeScriptCalls = (
    file: CommittedSourceFile,
    target: SymbolCandidate,
): LocatedCall[] => {
    const targetName = symbolName(target.identity);
    const sourceFile = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
        file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const localNames = new Set<string>();
    const namespaceNames = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !matchesTypeScriptModule(file.path, statement.moduleSpecifier.text, target.path)) {
            continue;
        }
        const clause = statement.importClause;
        if (clause?.name !== undefined && (target.isDefaultExport || clause.name.text === targetName)) {
            localNames.add(clause.name.text);
        }
        if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
                if ((element.propertyName?.text ?? element.name.text) === targetName) {
                    localNames.add(element.name.text);
                }
            }
        }
        if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
            namespaceNames.add(clause.namedBindings.name.text);
        }
    }
    const calls: LocatedCall[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const direct = ts.isIdentifier(node.expression) && localNames.has(node.expression.text);
            const namespaced = ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression)
                && namespaceNames.has(node.expression.expression.text)
                && node.expression.name.text === targetName;
            if (direct || namespaced) {
                calls.push({
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    argumentCount: node.arguments.length,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return calls;
};

const findImportedJavaCalls = (
    file: CommittedSourceFile,
    target: SymbolCandidate,
): LocatedCall[] => {
    const [owner, method] = target.identity.qualifiedName.split("#");
    if (owner === undefined) {
        return [];
    }
    const ownerName = owner.split(".").at(-1);
    const ownerPackage = owner.split(".").slice(0, -1).join(".");
    const callerPackage = /^\s*package\s+([\w.]+)\s*;/mu.exec(file.content)?.[1];
    if (ownerName === undefined || (!file.content.includes(`import ${owner};`) && callerPackage !== ownerPackage)) {
        return [];
    }
    const receiverNames = new Set<string>([ownerName]);
    const bindingPattern = new RegExp(`\\b${escapeRegExp(ownerName)}(?:<[^;=,)]+>)?\\s+([A-Za-z_$][\\w$]*)`, "gu");
    for (const binding of file.content.matchAll(bindingPattern)) {
        if (binding[1] !== undefined) {
            receiverNames.add(binding[1]);
        }
    }
    const methodPattern = method === undefined
        ? new RegExp(`\\bnew\\s+${escapeRegExp(ownerName)}\\s*\\(`, "u")
        : new RegExp(`\\b(?:${[...receiverNames].map(escapeRegExp).join("|")})\\s*\\.\\s*${escapeRegExp(method)}\\s*\\(`, "u");
    const calls: LocatedCall[] = [];
    const cursor = javaParser.parse(file.content).cursor();
    do {
        if (cursor.name !== "MethodInvocation" && cursor.name !== "ObjectCreationExpression") {
            continue;
        }
        const invocation = file.content.slice(cursor.from, cursor.to);
        if (methodPattern.test(invocation)) {
            const argumentsText = invocation.slice(invocation.indexOf("(") + 1, invocation.lastIndexOf(")")).trim();
            calls.push({
                line: file.content.slice(0, cursor.from).split(/\r?\n/u).length,
                argumentCount: argumentsText === "" ? 0 : argumentsText.split(",").length,
            });
        }
    } while (cursor.next());
    return calls;
};

const importsTypeScriptType = (
    file: CommittedSourceFile,
    localName: string,
    target: SymbolCandidate,
): boolean => {
    const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !matchesTypeScriptModule(file.path, statement.moduleSpecifier.text, target.path)) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)
            && bindings.elements.some((element) => element.name.text === localName
                && (element.propertyName?.text ?? element.name.text) === symbolName(target.identity))) {
            return true;
        }
        if (statement.importClause?.name?.text === localName) {
            return true;
        }
    }
    return false;
};

const resolveInheritanceRelations = (
    relations: StaticImpactRelation[],
    files: readonly CommittedSourceFile[],
    repositorySymbols: readonly SymbolCandidate[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): void => {
    for (const relation of relations.filter((candidate) => candidate.kind === "inherits" || candidate.kind === "implements")) {
        const source = relation.sourceSymbol;
        const file = files.find((candidate) => candidate.path === relation.sourcePath);
        if (source === undefined || file === undefined) {
            continue;
        }
        const localName = relation.target.split(".").at(-1)?.replace(/<.*$/u, "");
        if (localName === undefined) {
            continue;
        }
        const candidates = repositorySymbols.filter((candidate) => candidate.revision === "head"
            && candidate.identity.language === source.language
            && candidate.identity.signature !== undefined
            && ["class", "interface", "type", "record"].includes(candidate.identity.signature)
            && (source.language === "typescript" || symbolName(candidate.identity) === localName))
            .filter((candidate) => {
                if (source.language === "typescript") {
                    return importsTypeScriptType(file, relation.target, candidate);
                }
                const packageName = candidate.identity.qualifiedName.split(".").slice(0, -1).join(".");
                const callerPackage = /^\s*package\s+([\w.]+)\s*;/mu.exec(file.content)?.[1];
                return file.content.includes(`import ${candidate.identity.qualifiedName};`) || callerPackage === packageName;
            });
        if (candidates.length === 1 && candidates[0] !== undefined) {
            relation.target = toSafeTarget(candidates[0].identity.qualifiedName);
            relation.targetSymbol = candidates[0].identity;
            relation.completeness = "partial";
        } else if (candidates.length > 1) {
            relation.completeness = "unknown";
            limitations.add("symbol-identity-ambiguous");
        }
    }
};

const appendRepositoryCallRelations = (
    relations: StaticImpactRelation[],
    files: readonly CommittedSourceFile[],
    headSymbols: readonly SymbolCandidate[],
    repositorySymbols: readonly SymbolCandidate[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): void => {
    const anchors = new Map<string, string>();
    for (const relation of relations) {
        if (relation.kind === "symbol-change" && relation.targetSymbol !== undefined) {
            anchors.set(relation.targetSymbol.stableId, relation.changeAnchorId);
        }
    }
    for (const target of headSymbols) {
        const anchorId = anchors.get(target.identity.stableId);
        if (anchorId === undefined) {
            continue;
        }
        for (const file of files) {
            if (file.path === target.path || file.language !== target.identity.language) {
                continue;
            }
            const calls = file.language === "typescript"
                ? findImportedTypeScriptCalls(file, target)
                : findImportedJavaCalls(file, target);
            for (const call of calls) {
                const signature = target.identity.signature;
                if (signature?.startsWith("(") === true) {
                    const overloads = [...new Map(repositorySymbols
                        .filter((candidate) => candidate.revision === "head"
                            && candidate.identity.qualifiedName === target.identity.qualifiedName
                            && candidate.identity.signature?.startsWith("(") === true)
                        .map((candidate) => [candidate.identity.stableId, candidate])).values()];
                    const compatible = overloads.filter((candidate) => {
                        const parameters = candidate.identity.signature?.slice(1, -1);
                        return (parameters === "" ? 0 : parameters?.split(",").length) === call.argumentCount;
                    });
                    if (compatible.length !== 1 || compatible[0]?.identity.stableId !== target.identity.stableId) {
                        limitations.add("overload-resolution-unavailable");
                        continue;
                    }
                }
                const safeTarget = toSafeTarget(target.identity.qualifiedName);
                const sourceSymbol = findNearestSourceSymbol(repositorySymbols, file.path, call.line);
                relations.push({
                    id: relationId(anchorId, "calls", call.line, `${file.path}:${safeTarget}`),
                    changeAnchorId: anchorId,
                    sourcePath: file.path,
                    sourceLine: call.line,
                    target: safeTarget,
                    kind: "calls",
                    completeness: "partial",
                    ...(sourceSymbol === undefined ? {} : {sourceSymbol}),
                    targetSymbol: target.identity,
                });
            }
        }
    }
};

const inheritanceTargets = (content: string, language: Language): {kind: "implements" | "inherits"; target: string}[] => {
    const splitTypes = (value: string): string[] => {
        const types: string[] = [];
        let start = 0;
        let depth = 0;
        for (let index = 0; index < value.length; index += 1) {
            const character = value[index];
            depth += character === "<" ? 1 : character === ">" ? -1 : 0;
            if (character === "," && depth === 0) {
                types.push(value.slice(start, index));
                start = index + 1;
            }
        }
        types.push(value.slice(start));
        return types;
    };
    const normalizeType = (value: string): string => value.trim().replace(/<.*>$/u, "");
    const results: {kind: "implements" | "inherits"; target: string}[] = [];
    const extendsMatch = /\bextends\s+([^\s{]+(?:\s*<[^>{}]+>)?)/u.exec(content)?.[1];
    if (extendsMatch !== undefined) {
        results.push({kind: "inherits", target: normalizeType(extendsMatch)});
    }
    const implementsMatch = /\bimplements\s+([^\{]+)/u.exec(content)?.[1];
    if (implementsMatch !== undefined) {
        for (const target of splitTypes(implementsMatch)) {
            results.push({kind: "implements", target: normalizeType(target)});
        }
    } else if (language === "java" && /^\s*interface\b/u.test(content) && extendsMatch !== undefined) {
        results[0] = {kind: "implements", target: normalizeType(extendsMatch)};
    }
    return results.filter((result) => result.target !== "");
};

const behavioralTargets = (content: string): {kind: "configures" | "publishes" | "consumes" | "persists"; target: string}[] => {
    const results: {kind: "configures" | "publishes" | "consumes" | "persists"; target: string}[] = [];
    for (const match of content.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)|@Value\(\s*["']\$\{([^}"']+)/gu)) {
        results.push({kind: "configures", target: match[1] ?? match[2] ?? "configuration"});
    }
    for (const match of content.matchAll(/\.\s*(emit|publish|send)\s*\(\s*["']([^"']+)["']/gu)) {
        results.push({kind: "publishes", target: match[2] ?? match[1] ?? "event"});
    }
    for (const match of content.matchAll(/\.\s*(on|once|subscribe|consume)\s*\(\s*["']([^"']+)["']/gu)) {
        results.push({kind: "consumes", target: match[2] ?? match[1] ?? "event"});
    }
    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*(?:Repository|Dao)?)\.(save|insert|update|delete|persist|merge)\s*\(/gu)) {
        results.push({kind: "persists", target: `${match[1] ?? "repository"}.${match[2] ?? "write"}`});
    }
    return results;
};

const callTargets = (content: string, declaredName: string | undefined): string[] => [...new Set(
    [...content.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/gu)]
        .map((match) => match[1])
        .filter((target): target is string => target !== undefined)
        .filter((target) => !callKeywords.has(target.split(".")[0] ?? target))
        .filter((target) => target !== declaredName)
        .filter((target) => !["require", "import"].includes(target)),
)];

/**
 * 从已提交 TypeScript/Java diff 提取观察性符号、调用和技术影响关系。
 *
 * 该索引只使用已锚定的变更行；动态分派、反射、代码生成及歧义身份均显式降级。
 */
export class ChangedImportSemanticImpactIndex implements SemanticImpactIndexPort {
    public constructor(private readonly revisionSource?: CommittedRevisionSourcePort) {}

    public async analyze(
        rawCodeChange: RawCodeChange,
        codeChange: CodeChange,
        signal: AbortSignal,
    ): Promise<SemanticImpactIndexResult> {
        if (signal.aborted) {
            throw signal.reason;
        }

        const relations: StaticImpactRelation[] = [];
        const limitations = new Set<ImpactPackage["limitations"][number]>();
        const changedLineSymbols: SymbolCandidate[] = [];
        const parsedFiles: {path: string; language: Language; lines: DiffLine[]}[] = [];

        for (const fileChange of rawCodeChange.fileChanges) {
            if (signal.aborted) {
                throw signal.reason;
            }
            if (isSensitiveFile(fileChange.file)) {
                continue;
            }
            const path = fileChange.file.path;
            const language: Language | undefined = /\.(?:[cm]?[jt]sx?)$/iu.test(path)
                ? "typescript"
                : /\.java$/iu.test(path)
                    ? "java"
                    : undefined;
            if (language === undefined) {
                limitations.add("unsupported-language");
                continue;
            }
            const lines = parseChangedLines(fileChange.diff);
            parsedFiles.push({path, language, lines});
            changedLineSymbols.push(...extractSymbols(path, language, lines, fileChange.file.previousPath));

            const text = lines.map((line) => line.content).join("\n");
            if (unsupportedDynamicDependency.test(text)) {
                limitations.add("dynamic-dependency-unavailable");
            }
            if (reflectionUsage.test(text)) {
                limitations.add("reflection-unavailable");
                limitations.add("dynamic-dispatch-unavailable");
            }
            if (generatedSource.test(path) || generatedSource.test(text)) {
                limitations.add("code-generation-unavailable");
            }
        }

        let repositorySymbols: SymbolCandidate[] = [];
        let headSourceFiles: readonly CommittedSourceFile[] = [];
        if (this.revisionSource !== undefined && rawCodeChange.revisionRange !== undefined) {
            const [baseSnapshot, headSnapshot] = await Promise.all([
                this.revisionSource.read(rawCodeChange.revisionRange, "base", signal),
                this.revisionSource.read(rawCodeChange.revisionRange, "head", signal),
            ]);
            if (baseSnapshot.status === "unavailable" || headSnapshot.status === "unavailable") {
                limitations.add("revision-source-unavailable");
            }
            if (baseSnapshot.status === "partial" || headSnapshot.status === "partial") {
                limitations.add("repository-scan-partial");
            }
            repositorySymbols = [
                ...baseSnapshot.files.flatMap((file) => extractSymbols(
                    file.path,
                    file.language,
                    sourceLines(file.content, "base"),
                    undefined,
                    true,
                )),
                ...headSnapshot.files.flatMap((file) => extractSymbols(
                    file.path,
                    file.language,
                    sourceLines(file.content, "head"),
                    undefined,
                    true,
                )),
            ];
            headSourceFiles = headSnapshot.files;
        }
        const changedSnapshotSymbols = selectChangedSymbols(repositorySymbols, parsedFiles);
        const allSymbols = [...new Map([...changedLineSymbols, ...changedSnapshotSymbols]
            .map((symbol) => [`${symbol.revision}:${symbol.identity.stableId}`, symbol])).values()];
        const baseSymbols = allSymbols.filter((symbol) => symbol.revision === "base");
        const headSymbols = allSymbols.filter((symbol) => symbol.revision === "head");
        for (const {candidate, mapping} of matchCandidates(baseSymbols, headSymbols)) {
            const anchor = locateAnchor(codeChange.chunks, candidate.path, candidate.line, candidate.revision);
            if (anchor === undefined) {
                limitations.add("source-change-unanchored");
                continue;
            }
            if (mapping.status === "ambiguous") {
                limitations.add("symbol-identity-ambiguous");
            }
            if (mapping.status === "unmatched") {
                limitations.add("symbol-identity-unmatched");
            }
            const target = toSafeTarget(mapping.head?.qualifiedName ?? mapping.base?.qualifiedName ?? "unmatched-symbol");
            relations.push({
                id: relationId(anchor.id, "symbol-change", candidate.line, target),
                changeAnchorId: anchor.id,
                sourcePath: anchor.path,
                sourceLine: candidate.line,
                target,
                kind: "symbol-change",
                completeness: mapping.status === "ambiguous" || mapping.status === "unmatched" ? "unknown" : "partial",
                ...(mapping.base === undefined ? {} : {sourceSymbol: mapping.base}),
                ...(mapping.head === undefined ? {} : {targetSymbol: mapping.head}),
                symbolMapping: mapping,
            });
        }

        for (const {path, language, lines} of parsedFiles) {
            const addedLines = lines.filter((line) => line.revision === "head");
            const firstAddedLine = addedLines[0];
            if (!testPath.test(path)) {
                const anchor = firstAddedLine === undefined ? undefined : locateAnchor(codeChange.chunks, path, firstAddedLine.line, "head");
                if (anchor === undefined || firstAddedLine === undefined) {
                    limitations.add("source-change-unanchored");
                } else {
                    const kind = language === "typescript" ? "typescript-source-change" : "java-source-change";
                    const target = language === "typescript" ? "changed-typescript-source" : "changed-java-source";
                    const sourceSymbol = findNearestSourceSymbol(allSymbols, path, firstAddedLine.line);
                    relations.push({
                        id: relationId(anchor.id, kind, firstAddedLine.line, target),
                        changeAnchorId: anchor.id,
                        sourcePath: anchor.path,
                        sourceLine: firstAddedLine.line,
                        target,
                        kind,
                        completeness: "partial",
                        ...(sourceSymbol === undefined ? {} : {sourceSymbol}),
                    });
                }
            }

            for (const addedLine of addedLines) {
                const anchor = locateAnchor(codeChange.chunks, path, addedLine.line, "head");
                if (anchor === undefined) {
                    limitations.add("source-change-unanchored");
                    continue;
                }
                const sourceSymbol = findNearestSourceSymbol(allSymbols, path, addedLine.line);
                const importedTarget = language === "typescript"
                    ? typeScriptImport.exec(addedLine.content)?.[1] ?? commonJsRequire.exec(addedLine.content)?.[1]
                    : javaImport.exec(addedLine.content)?.[1];
                if (importedTarget !== undefined) {
                    const target = toSafeTarget(importedTarget);
                    const kind = language === "typescript" ? "module-import" : "java-import";
                    relations.push({
                        id: relationId(anchor.id, kind, addedLine.line, target),
                        changeAnchorId: anchor.id,
                        sourcePath: anchor.path,
                        sourceLine: addedLine.line,
                        target,
                        kind,
                        completeness: "partial",
                        ...(sourceSymbol === undefined ? {} : {sourceSymbol}),
                    });
                }

                const declaredName = headSymbols.find((symbol) => symbol.path === path && symbol.line === addedLine.line)?.name;
                const semanticTargets: {kind: ImpactRelationKind; target: string; completeness: "partial" | "unknown"}[] = [
                    ...inheritanceTargets(addedLine.content, language).map((entry) => ({...entry, completeness: "partial" as const})),
                    ...behavioralTargets(addedLine.content).map((entry) => ({...entry, completeness: "partial" as const})),
                    ...callTargets(addedLine.content, declaredName).map((target) => ({kind: "calls" as const, target, completeness: "unknown" as const})),
                ];
                for (const semanticTarget of semanticTargets) {
                    const target = toSafeTarget(semanticTarget.target);
                    relations.push({
                        id: relationId(anchor.id, semanticTarget.kind, addedLine.line, target),
                        changeAnchorId: anchor.id,
                        sourcePath: anchor.path,
                        sourceLine: addedLine.line,
                        target,
                        kind: semanticTarget.kind,
                        completeness: semanticTarget.completeness,
                        ...(sourceSymbol === undefined ? {} : {sourceSymbol}),
                    });
                    if (semanticTarget.kind === "calls") {
                        limitations.add("dynamic-dispatch-unavailable");
                    }
                }
            }
        }

        resolveInheritanceRelations(
            relations,
            headSourceFiles,
            repositorySymbols,
            limitations,
        );
        appendRepositoryCallRelations(
            relations,
            headSourceFiles,
            headSymbols,
            repositorySymbols.filter((symbol) => symbol.revision === "head"),
            limitations,
        );

        return {
            relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
            limitations: [...limitations],
        };
    }
}
