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
    isOwnerDefaultExport: boolean;
    isExported: boolean;
    isOwnerExported: boolean;
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
            isOwnerDefaultExport: false,
            isExported: language !== "typescript" || /^export\b/u.test(content),
            isOwnerExported: false,
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

const extractTypeScriptAstSymbols = (
    file: CommittedSourceFile,
    revision: Revision,
): SymbolCandidate[] => {
    const sourceFile = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
        file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const qualifier = moduleQualifier(file.path, "typescript");
    const candidates: SymbolCandidate[] = [];
    const addCandidate = (
        node: ts.Node,
        name: string,
        qualifiedName: string,
        signature: string,
        isDefaultExport: boolean,
        isExported: boolean,
        isOwnerDefaultExport = false,
        isOwnerExported = false,
    ): void => {
        const source = node.getText(sourceFile);
        const identity = createSymbolIdentity("typescript", qualifiedName, signature, source);
        candidates.push({
            identity,
            revision,
            path: file.path,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            name,
            shapeDigest: digest(source.replace(new RegExp(`\\b${name}\\b`, "gu"), "$symbol").replace(/\s+/gu, " ")),
            isDefaultExport,
            isOwnerDefaultExport,
            isExported,
            isOwnerExported,
        });
    };
    const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
        ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
    const hasDefaultModifier = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.DefaultKeyword);
    const parametersOf = (parameters: ts.NodeArray<ts.ParameterDeclaration>): string =>
        `(${parameters.map((parameter) => parameter.type?.getText(sourceFile) ?? "unknown").join(",")})`;
    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
            addCandidate(
                statement,
                statement.name.text,
                `${qualifier}.${statement.name.text}`,
                parametersOf(statement.parameters),
                hasDefaultModifier(statement),
                hasModifier(statement, ts.SyntaxKind.ExportKeyword),
            );
            continue;
        }
        const typeName = (ts.isClassDeclaration(statement)
            || ts.isInterfaceDeclaration(statement)
            || ts.isTypeAliasDeclaration(statement)
            || ts.isEnumDeclaration(statement))
            ? statement.name?.text
            : undefined;
        if (typeName === undefined) {
            continue;
        }
        const kind = ts.isClassDeclaration(statement)
            ? "class"
            : ts.isInterfaceDeclaration(statement)
                ? "interface"
                : ts.isTypeAliasDeclaration(statement)
                    ? "type"
                    : "enum";
        const ownerIsExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
        addCandidate(statement, typeName, `${qualifier}.${typeName}`, kind, hasDefaultModifier(statement), ownerIsExported);
        if (!ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) {
            continue;
        }
        for (const member of statement.members) {
            if ((!ts.isMethodDeclaration(member) && !ts.isMethodSignature(member))
                || (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name))) {
                continue;
            }
            addCandidate(
                member,
                member.name.text,
                `${qualifier}.${typeName}#${member.name.text}`,
                parametersOf(member.parameters),
                false,
                false,
                hasDefaultModifier(statement),
                ownerIsExported,
            );
        }
    }
    return candidates;
};

const extractRepositorySymbols = (file: CommittedSourceFile, revision: Revision): SymbolCandidate[] =>
    file.language === "typescript"
        ? extractTypeScriptAstSymbols(file, revision)
        : extractSymbols(file.path, file.language, sourceLines(file.content, revision), undefined, true);

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
    argumentTypes: readonly string[];
}

type TypeScriptTypeResolver = (path: string, position: number) => string;

const createTypeScriptTypeResolver = (
    files: readonly CommittedSourceFile[],
    configuration: {path: "tsconfig.json"; content: string} | undefined,
    limitations: Set<ImpactPackage["limitations"][number]>,
): TypeScriptTypeResolver | undefined => {
    const typeScriptFiles = files.filter((file) => file.language === "typescript");
    if (typeScriptFiles.length === 0) {
        return undefined;
    }
    const parsedConfiguration = configuration === undefined
        ? {config: {}}
        : ts.parseConfigFileTextToJson(configuration.path, configuration.content);
    if (parsedConfiguration.error !== undefined || parsedConfiguration.config === undefined) {
        limitations.add("typescript-configuration-unavailable");
        return undefined;
    }
    if (parsedConfiguration.config.extends !== undefined || parsedConfiguration.config.references !== undefined) {
        limitations.add("typescript-configuration-unavailable");
    }
    const converted = ts.convertCompilerOptionsFromJson(parsedConfiguration.config.compilerOptions ?? {}, "/repo");
    if (converted.errors.length > 0) {
        limitations.add("typescript-configuration-unavailable");
    }
    const options: ts.CompilerOptions = {
        ...converted.options,
        noEmit: true,
        noLib: true,
        allowJs: false,
        plugins: [],
    };
    const virtualPath = (path: string): string => `/repo/${canonicalPath(path).replace(/^\/+/, "")}`;
    const contentByPath = new Map(typeScriptFiles.map((file) => [virtualPath(file.path), file.content]));
    const directories = new Set<string>(["/repo"]);
    for (const path of contentByPath.keys()) {
        let directory = pathTools.dirname(path);
        while (directory.startsWith("/repo")) {
            directories.add(directory);
            if (directory === "/repo") {
                break;
            }
            directory = pathTools.dirname(directory);
        }
    }
    const host: ts.CompilerHost = {
        fileExists: (path) => contentByPath.has(canonicalPath(path)),
        readFile: (path) => contentByPath.get(canonicalPath(path)),
        getSourceFile: (path, languageVersion) => {
            const content = contentByPath.get(canonicalPath(path));
            return content === undefined
                ? undefined
                : ts.createSourceFile(path, content, languageVersion, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        },
        getDefaultLibFileName: () => "",
        writeFile: () => undefined,
        getCurrentDirectory: () => "/repo",
        directoryExists: (path) => directories.has(canonicalPath(path)),
        getDirectories: (path) => [...directories]
            .filter((directory) => pathTools.dirname(directory) === canonicalPath(path)),
        realpath: canonicalPath,
        getCanonicalFileName: (path) => path,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
    };
    const program = ts.createProgram({rootNames: [...contentByPath.keys()], options, host});
    const checker = program.getTypeChecker();
    return (path, position) => {
        const sourceFile = program.getSourceFile(virtualPath(path));
        if (sourceFile === undefined) {
            return "unknown";
        }
        let matched: ts.Expression | undefined;
        const visit = (node: ts.Node): void => {
            if (node.getStart(sourceFile) === position && ts.isExpression(node)) {
                matched = node;
                return;
            }
            if (position >= node.getFullStart() && position <= node.getEnd()) {
                ts.forEachChild(node, visit);
            }
        };
        visit(sourceFile);
        if (matched === undefined) {
            return "unknown";
        }
        const type = checker.getTypeAtLocation(matched);
        if ((type.flags & ts.TypeFlags.StringLike) !== 0) {
            return "string";
        }
        if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
            return "number";
        }
        if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) {
            return "boolean";
        }
        if ((type.flags & ts.TypeFlags.Null) !== 0) {
            return "null";
        }
        return "unknown";
    };
};

const matchesTypeScriptModule = (callerPath: string, moduleReference: string, targetPath: string): boolean => {
    if (!moduleReference.startsWith(".")) {
        return false;
    }
    const importedModule = pathTools.normalize(pathTools.join(pathTools.dirname(callerPath), moduleReference))
        .replace(/\.(?:[cm]?[jt]sx?|js)$/iu, "");
    const targetModule = canonicalPath(targetPath).replace(/\.(?:[cm]?[jt]sx?)$/iu, "");
    return importedModule === targetModule || `${importedModule}/index` === targetModule;
};

const findTypeScriptModuleFile = (
    callerPath: string,
    moduleReference: string,
    files: readonly CommittedSourceFile[],
): CommittedSourceFile | undefined => files.find((candidate) => candidate.language === "typescript"
    && matchesTypeScriptModule(callerPath, moduleReference, candidate.path));

const exportedNamesForModule = (
    callerPath: string,
    moduleReference: string,
    target: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    subjectName: string,
    subjectIsDefault: boolean,
    limitations: Set<ImpactPackage["limitations"][number]>,
    visited: ReadonlySet<string> = new Set(),
    depth = 0,
): Set<string> => {
    if (matchesTypeScriptModule(callerPath, moduleReference, target.path)) {
        const subjectIsExported = target.identity.qualifiedName.includes("#") ? target.isOwnerExported : target.isExported;
        if (!subjectIsExported) {
            return new Set();
        }
        return new Set([subjectName, ...(subjectIsDefault ? ["default"] : [])]);
    }
    const barrel = findTypeScriptModuleFile(callerPath, moduleReference, files);
    if (barrel === undefined || barrel.path === target.path) {
        return new Set();
    }
    if (visited.has(barrel.path)) {
        limitations.add("barrel-cycle-unavailable");
        return new Set();
    }
    if (depth >= 4) {
        limitations.add("barrel-depth-unavailable");
        return new Set();
    }
    const nextVisited = new Set(visited).add(barrel.path);
    const sourceFile = ts.createSourceFile(barrel.path, barrel.content, ts.ScriptTarget.Latest, true);
    const exportedNames = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement)
            || statement.moduleSpecifier === undefined
            || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const downstreamNames = exportedNamesForModule(
            barrel.path,
            statement.moduleSpecifier.text,
            target,
            files,
            subjectName,
            subjectIsDefault,
            limitations,
            nextVisited,
            depth + 1,
        );
        if (statement.exportClause === undefined) {
            for (const downstreamName of downstreamNames) {
                if (downstreamName !== "default") {
                    exportedNames.add(downstreamName);
                }
            }
            continue;
        }
        if (!ts.isNamedExports(statement.exportClause)) {
            continue;
        }
        for (const element of statement.exportClause.elements) {
            const originalName = element.propertyName?.text ?? element.name.text;
            if (downstreamNames.has(originalName)) {
                exportedNames.add(element.name.text);
            }
        }
    }
    return exportedNames;
};

const importBindsTypeScriptName = (
    file: CommittedSourceFile,
    localName: string,
    owner: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): boolean => {
    const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const exportedNames = exportedNamesForModule(
            file.path,
            statement.moduleSpecifier.text,
            owner,
            files,
            symbolName(owner.identity),
            owner.isDefaultExport,
            limitations,
        );
        if (exportedNames.has("default") && statement.importClause?.name?.text === localName) {
            return true;
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)
            && bindings.elements.some((element) => element.name.text === localName
                && exportedNames.has(element.propertyName?.text ?? element.name.text))) {
            return true;
        }
    }
    return false;
};

const findTypeScriptMethodOwners = (
    target: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    repositorySymbols: readonly SymbolCandidate[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): SymbolCandidate[] => {
    const ownerQualifiedName = target.identity.qualifiedName.split("#")[0];
    if (ownerQualifiedName === undefined || !target.identity.qualifiedName.includes("#")) {
        return [];
    }
    const directOwner = repositorySymbols.find((candidate) => candidate.revision === "head"
        && candidate.identity.qualifiedName === ownerQualifiedName
        && candidate.identity.signature === "class");
    if (directOwner === undefined) {
        return [];
    }
    const owners = [directOwner];
    const visited = new Set([directOwner.identity.stableId]);
    let frontier = [directOwner];
    for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
        const next: SymbolCandidate[] = [];
        for (const currentOwner of frontier) {
            for (const candidate of repositorySymbols.filter((symbol) => symbol.revision === "head"
                && symbol.identity.language === "typescript"
                && symbol.identity.signature === "class"
                && !visited.has(symbol.identity.stableId))) {
                const file = files.find((source) => source.path === candidate.path);
                if (file === undefined) {
                    continue;
                }
                const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
                const declaration = sourceFile.statements.find((statement): statement is ts.ClassDeclaration =>
                    ts.isClassDeclaration(statement) && statement.name?.text === symbolName(candidate.identity));
                const baseExpression = declaration?.heritageClauses
                    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
                    ?.types[0]?.expression;
                if (baseExpression !== undefined && ts.isIdentifier(baseExpression)
                    && (importBindsTypeScriptName(file, baseExpression.text, currentOwner, files, limitations)
                        || (file.path === currentOwner.path
                            && baseExpression.text === symbolName(currentOwner.identity)))) {
                    visited.add(candidate.identity.stableId);
                    owners.push(candidate);
                    next.push(candidate);
                }
            }
        }
        frontier = next;
    }
    if (frontier.length > 0) {
        limitations.add("inheritance-depth-unavailable");
    }
    return owners;
};

const findImportedTypeScriptCalls = (
    file: CommittedSourceFile,
    target: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    limitations: Set<ImpactPackage["limitations"][number]>,
    methodOwners: readonly SymbolCandidate[],
    typeResolver: TypeScriptTypeResolver | undefined,
): LocatedCall[] => {
    const [ownerQualifiedName, methodName] = target.identity.qualifiedName.split("#");
    const targetName = methodName ?? symbolName(target.identity);
    const ownerName = methodName === undefined ? undefined : ownerQualifiedName?.split(".").at(-1);
    const sourceFile = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
        file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const localNames = new Set<string>();
    const namespaceNames = new Set<string>();
    const ownerLocalNames = new Set<string>();
    const namespaceMemberNames = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const exportedNames = new Set<string>();
        const subjects = ownerName === undefined ? [target] : methodOwners;
        for (const subject of subjects) {
            const names = exportedNamesForModule(
                file.path,
                statement.moduleSpecifier.text,
                subject,
                files,
                symbolName(subject.identity),
                subject.isDefaultExport,
                limitations,
            );
            for (const name of names) {
                exportedNames.add(name);
            }
        }
        if (exportedNames.size === 0) {
            continue;
        }
        const clause = statement.importClause;
        if (clause?.name !== undefined && exportedNames.has("default") && ownerName === undefined) {
            localNames.add(clause.name.text);
        }
        if (clause?.name !== undefined && exportedNames.has("default") && ownerName !== undefined) {
            ownerLocalNames.add(clause.name.text);
        }
        if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
                const importedName = element.propertyName?.text ?? element.name.text;
                if (ownerName === undefined && exportedNames.has(importedName)) {
                    localNames.add(element.name.text);
                }
                if (ownerName !== undefined && exportedNames.has(importedName)) {
                    ownerLocalNames.add(element.name.text);
                }
            }
        }
        if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
            namespaceNames.add(clause.namedBindings.name.text);
            for (const exportedName of exportedNames) {
                if (exportedName !== "default") {
                    namespaceMemberNames.add(exportedName);
                }
            }
        }
    }
    const receiverNames = new Set<string>();
    const localValueTypes = new Map<string, string>();
    const inferLiteralType = (expression: ts.Expression): string => {
        if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            return "string";
        }
        if (ts.isNumericLiteral(expression)) {
            return "number";
        }
        if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
            return "boolean";
        }
        if (expression.kind === ts.SyntaxKind.NullKeyword) {
            return "null";
        }
        return "unknown";
    };
    const collectReceiver = (node: ts.Node): void => {
        if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node))
            && ts.isIdentifier(node.name)) {
            const typeName = node.type !== undefined && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)
                ? node.type.typeName.text
                : undefined;
            const constructedType = node.initializer !== undefined
                && ts.isNewExpression(node.initializer)
                && ts.isIdentifier(node.initializer.expression)
                ? node.initializer.expression.text
                : undefined;
            if ((typeName !== undefined && ownerLocalNames.has(typeName))
                || (constructedType !== undefined && ownerLocalNames.has(constructedType))) {
                receiverNames.add(node.name.text);
            }
            const annotatedType = node.type?.getText(sourceFile).replace(/\s+/gu, "");
            const valueType = annotatedType !== undefined && ["string", "number", "boolean", "null"].includes(annotatedType)
                ? annotatedType
                : node.initializer === undefined
                    ? "unknown"
                    : inferLiteralType(node.initializer);
            if (valueType !== "unknown") {
                localValueTypes.set(node.name.text, valueType);
            }
        }
        ts.forEachChild(node, collectReceiver);
    };
    collectReceiver(sourceFile);
    const inferArgumentType = (argument: ts.Expression): string => {
        const checkedType = typeResolver?.(file.path, argument.getStart(sourceFile)) ?? "unknown";
        if (checkedType !== "unknown") {
            return checkedType;
        }
        return ts.isIdentifier(argument)
            ? localValueTypes.get(argument.text) ?? "unknown"
            : inferLiteralType(argument);
    };
    const calls: LocatedCall[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const direct = methodName === undefined && ts.isIdentifier(node.expression) && localNames.has(node.expression.text);
            const namespaced = methodName === undefined && ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression)
                && namespaceNames.has(node.expression.expression.text)
                && namespaceMemberNames.has(node.expression.name.text);
            const memberCall = methodName !== undefined
                && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === methodName
                && ((ts.isIdentifier(node.expression.expression)
                    && (receiverNames.has(node.expression.expression.text)
                        || ownerLocalNames.has(node.expression.expression.text)))
                    || (ts.isNewExpression(node.expression.expression)
                        && ts.isIdentifier(node.expression.expression.expression)
                        && ownerLocalNames.has(node.expression.expression.expression.text)));
            if (direct || namespaced || memberCall) {
                calls.push({
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    argumentCount: node.arguments.length,
                    argumentTypes: node.arguments.map(inferArgumentType),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return calls;
};

const javaFileImportsOwner = (file: CommittedSourceFile, owner: SymbolCandidate): boolean => {
    const qualifiedName = owner.identity.qualifiedName;
    const packageName = qualifiedName.split(".").slice(0, -1).join(".");
    const callerPackage = /^\s*package\s+([\w.]+)\s*;/mu.exec(file.content)?.[1];
    return file.content.includes(`import ${qualifiedName};`)
        || file.content.includes(`import ${packageName}.*;`)
        || callerPackage === packageName;
};

const findJavaMethodOwners = (
    target: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    repositorySymbols: readonly SymbolCandidate[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): SymbolCandidate[] => {
    const ownerQualifiedName = target.identity.qualifiedName.split("#")[0];
    if (ownerQualifiedName === undefined || !target.identity.qualifiedName.includes("#")) {
        return [];
    }
    const directOwner = repositorySymbols.find((candidate) => candidate.revision === "head"
        && candidate.identity.language === "java"
        && candidate.identity.qualifiedName === ownerQualifiedName
        && candidate.identity.signature === "class");
    if (directOwner === undefined) {
        return [];
    }
    const owners = [directOwner];
    const visited = new Set([directOwner.identity.stableId]);
    let frontier = [directOwner];
    for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
        const next: SymbolCandidate[] = [];
        for (const currentOwner of frontier) {
            const currentName = symbolName(currentOwner.identity);
            const extendsPattern = new RegExp(
                `\\bextends\\s+${escapeRegExp(currentName)}(?:\\s*<[^>{}]+>)?(?=\\s|\\{|implements\\b)`,
                "u",
            );
            for (const candidate of repositorySymbols.filter((symbol) => symbol.revision === "head"
                && symbol.identity.language === "java"
                && symbol.identity.signature === "class"
                && !visited.has(symbol.identity.stableId))) {
                const file = files.find((source) => source.path === candidate.path);
                if (file === undefined || !javaFileImportsOwner(file, currentOwner) || !extendsPattern.test(file.content)) {
                    continue;
                }
                visited.add(candidate.identity.stableId);
                owners.push(candidate);
                next.push(candidate);
            }
        }
        frontier = next;
    }
    if (frontier.length > 0) {
        limitations.add("inheritance-depth-unavailable");
    }
    return owners;
};

const findImportedJavaCalls = (
    file: CommittedSourceFile,
    target: SymbolCandidate,
    methodOwners: readonly SymbolCandidate[],
): LocatedCall[] => {
    const [, method] = target.identity.qualifiedName.split("#");
    if (method === undefined) {
        return [];
    }
    const importedOwners = methodOwners.filter((owner) => javaFileImportsOwner(file, owner));
    if (importedOwners.length === 0) {
        return [];
    }
    const receiverNames = new Set<string>();
    for (const owner of importedOwners) {
        const ownerName = symbolName(owner.identity);
        receiverNames.add(ownerName);
        const bindingPattern = new RegExp(`\\b${escapeRegExp(ownerName)}(?:<[^;=,)]+>)?\\s+([A-Za-z_$][\\w$]*)`, "gu");
        for (const binding of file.content.matchAll(bindingPattern)) {
            if (binding[1] !== undefined) {
                receiverNames.add(binding[1]);
            }
        }
    }
    const localValueTypes = new Map<string, string>();
    for (const binding of file.content.matchAll(/\b(String|java\.lang\.String|boolean|Boolean|byte|short|int|long|float|double|Number|Integer)\s+([A-Za-z_$][\w$]*)/gu)) {
        if (binding[1] !== undefined && binding[2] !== undefined) {
            localValueTypes.set(binding[2], binding[1]);
        }
    }
    const methodPattern = new RegExp(
        `\\b(?:${[...receiverNames].map(escapeRegExp).join("|")})\\s*\\.\\s*${escapeRegExp(method)}\\s*\\(`,
        "u",
    );
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
                argumentTypes: argumentsText === "" ? [] : argumentsText.split(",").map((argument) => {
                    const value = argument.trim();
                    return /^"|^'/u.test(value)
                        ? "String"
                        : /^-?\d+(?:\.\d+)?[dDfFlL]?$/u.test(value)
                            ? "number"
                            : /^(?:true|false)$/u.test(value)
                                ? "boolean"
                                : localValueTypes.get(value) ?? "unknown";
                }),
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
                return file.content.includes(`import ${candidate.identity.qualifiedName};`)
                    || file.content.includes(`import ${packageName}.*;`)
                    || callerPackage === packageName;
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
    typeResolver: TypeScriptTypeResolver | undefined,
): void => {
    const acceptsArgumentType = (parameterType: string, argumentType: string, language: Language): boolean => {
        if (argumentType === "unknown") {
            return true;
        }
        const normalized = parameterType.replace(/\s+/gu, "").toLowerCase();
        if (language === "typescript") {
            return normalized.split("|").includes(argumentType.toLowerCase());
        }
        if (argumentType === "String") {
            return normalized === "string" || normalized === "java.lang.string";
        }
        if (argumentType === "boolean") {
            return normalized === "boolean" || normalized === "boolean";
        }
        return ["byte", "short", "int", "long", "float", "double", "number", "integer"].some((type) => normalized === type);
    };
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
        const typeScriptMethodOwners = target.identity.language === "typescript"
            ? findTypeScriptMethodOwners(target, files, repositorySymbols, limitations)
            : [];
        const javaMethodOwners = target.identity.language === "java"
            ? findJavaMethodOwners(target, files, repositorySymbols, limitations)
            : [];
        for (const file of files) {
            if (file.path === target.path || file.language !== target.identity.language) {
                continue;
            }
            const calls = file.language === "typescript"
                ? findImportedTypeScriptCalls(file, target, files, limitations, typeScriptMethodOwners, typeResolver)
                : findImportedJavaCalls(file, target, javaMethodOwners);
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
                    const typeCompatible = compatible.length <= 1 ? compatible : compatible.filter((candidate) => {
                        const parameters = candidate.identity.signature?.slice(1, -1).split(",") ?? [];
                        return parameters.every((parameter, index) =>
                            acceptsArgumentType(parameter, call.argumentTypes[index] ?? "unknown", target.identity.language));
                    });
                    if (typeCompatible.length !== 1 || typeCompatible[0]?.identity.stableId !== target.identity.stableId) {
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
        let headTypeScriptConfiguration: {path: "tsconfig.json"; content: string} | undefined;
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
                ...baseSnapshot.files.flatMap((file) => extractRepositorySymbols(file, "base")),
                ...headSnapshot.files.flatMap((file) => extractRepositorySymbols(file, "head")),
            ];
            headSourceFiles = headSnapshot.files;
            headTypeScriptConfiguration = headSnapshot.typeScriptConfiguration;
        }
        const changedSnapshotSymbols = selectChangedSymbols(repositorySymbols, parsedFiles);
        const snapshotCoveredFiles = new Set(changedSnapshotSymbols.map((symbol) => `${symbol.revision}:${symbol.path}`));
        const fallbackChangedLineSymbols = changedLineSymbols.filter((symbol) =>
            !snapshotCoveredFiles.has(`${symbol.revision}:${symbol.path}`));
        const allSymbols = [...new Map([...fallbackChangedLineSymbols, ...changedSnapshotSymbols]
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
        const typeResolver = createTypeScriptTypeResolver(
            headSourceFiles,
            headTypeScriptConfiguration,
            limitations,
        );
        appendRepositoryCallRelations(
            relations,
            headSourceFiles,
            headSymbols,
            repositorySymbols.filter((symbol) => symbol.revision === "head"),
            limitations,
            typeResolver,
        );

        return {
            relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
            limitations: [...limitations],
        };
    }
}
