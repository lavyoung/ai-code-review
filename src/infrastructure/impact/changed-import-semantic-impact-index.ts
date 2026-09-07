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
    CommittedRevisionSourceSnapshot,
    CommittedSourceFile,
} from "../../application/review/ports/committed-revision-source-port.js";
import {resolveCommittedTypeScriptProjects} from "./committed-typescript-configuration.js";

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

interface JavaMethodOwner {
    owner: SymbolCandidate;
    typeParameters: readonly string[];
    substitutions: ReadonlyMap<string, string>;
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

/** 按顶层逗号拆分泛型、参数或实参，避免把嵌套类型参数误判为多个参数。 */
const splitTopLevelComma = (value: string): string[] => {
    const entries: string[] = [];
    let start = 0;
    let angleDepth = 0;
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote: "\"" | "'" | undefined;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (quote !== undefined) {
            if (character === quote && value[index - 1] !== "\\") {
                quote = undefined;
            }
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === "<") {
            angleDepth += 1;
        } else if (character === ">") {
            angleDepth = Math.max(0, angleDepth - 1);
        } else if (character === "(") {
            parenthesisDepth += 1;
        } else if (character === ")") {
            parenthesisDepth = Math.max(0, parenthesisDepth - 1);
        } else if (character === "[") {
            bracketDepth += 1;
        } else if (character === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (character === "{") {
            braceDepth += 1;
        } else if (character === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
        } else if (character === ","
            && angleDepth === 0
            && parenthesisDepth === 0
            && bracketDepth === 0
            && braceDepth === 0) {
            entries.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    entries.push(value.slice(start).trim());
    return entries.filter((entry) => entry !== "");
};

const normalizeParameters = (parameters: string, language: Language): string => {
    if (parameters.trim() === "") {
        return "()";
    }
    const types = splitTopLevelComma(parameters).map((parameter) => {
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
    javaTypeSubstitutions?: readonly (readonly [string, string])[];
}

type TypeScriptTypeResolver = (path: string, position: number) => string;

const createTypeScriptTypeResolver = (
    files: readonly CommittedSourceFile[],
    configuration: CommittedRevisionSourceSnapshot["typeScriptConfiguration"],
    limitations: Set<ImpactPackage["limitations"][number]>,
): TypeScriptTypeResolver | undefined => {
    const typeScriptFiles = files.filter((file) => file.language === "typescript");
    if (typeScriptFiles.length === 0) {
        return undefined;
    }
    const projects = configuration === undefined
        ? [{configurationPath: "tsconfig.json", directory: ".", options: {}}]
        : resolveCommittedTypeScriptProjects(configuration);
    if (projects === undefined) {
        limitations.add("typescript-configuration-unavailable");
        return undefined;
    }
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
    const createHost = (directory: string): ts.CompilerHost => ({
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
        getCurrentDirectory: () => directory === "." ? "/repo" : `/repo/${directory}`,
        directoryExists: (path) => directories.has(canonicalPath(path)),
        getDirectories: (path) => [...directories]
            .filter((directory) => pathTools.dirname(directory) === canonicalPath(path)),
        realpath: canonicalPath,
        getCanonicalFileName: (path) => path,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
    });
    const projectPrograms = projects.map((project) => {
        const rootNames = typeScriptFiles
            .filter((file) => project.directory === "."
                || canonicalPath(file.path).startsWith(`${project.directory}/`))
            .map((file) => virtualPath(file.path));
        const options: ts.CompilerOptions = {
            ...project.options,
            noEmit: true,
            noLib: true,
            allowJs: false,
            plugins: [],
        };
        const program = ts.createProgram({rootNames, options, host: createHost(project.directory)});
        return {...project, program, checker: program.getTypeChecker()};
    });
    return (path, position) => {
        const normalizedPath = canonicalPath(path);
        const project = [...projectPrograms]
            .filter((candidate) => candidate.directory === "."
                || normalizedPath.startsWith(`${candidate.directory}/`))
            .sort((left, right) => right.directory.length - left.directory.length)[0];
        if (project === undefined) {
            return "unknown";
        }
        const sourceFile = project.program.getSourceFile(virtualPath(path));
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
        const type = project.checker.getTypeAtLocation(matched);
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

interface JavaTypeReference {
    qualifiedOrSimpleName: string;
    typeArguments: readonly string[];
}

interface JavaTypeDefinition {
    typeParameters: readonly string[];
    superTypes: readonly JavaTypeReference[];
}

const matchingAngleBracket = (value: string, start: number): number | undefined => {
    let depth = 0;
    for (let index = start; index < value.length; index += 1) {
        if (value[index] === "<") {
            depth += 1;
        } else if (value[index] === ">") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return undefined;
};

const parseJavaTypeReference = (value: string): JavaTypeReference | undefined => {
    const normalized = value.replace(/@[A-Za-z_$][\w.$]*(?:\([^)]*\))?/gu, "").trim();
    const angleStart = normalized.indexOf("<");
    const angleEnd = angleStart < 0 ? undefined : matchingAngleBracket(normalized, angleStart);
    if (angleStart >= 0 && (angleEnd === undefined || normalized.slice(angleEnd + 1).trim() !== "")) {
        return undefined;
    }
    const qualifiedOrSimpleName = (angleStart < 0 ? normalized : normalized.slice(0, angleStart)).trim();
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(qualifiedOrSimpleName)) {
        return undefined;
    }
    return {
        qualifiedOrSimpleName,
        typeArguments: angleStart < 0 || angleEnd === undefined
            ? []
            : splitTopLevelComma(normalized.slice(angleStart + 1, angleEnd)),
    };
};

/** 读取单个已提交 Java 顶层类型的泛型参数和直接父类型，不解析或执行注解处理器。 */
const readJavaTypeDefinition = (
    file: CommittedSourceFile,
    owner: SymbolCandidate,
): JavaTypeDefinition | undefined => {
    const declaration = new RegExp(`\\b(?:class|interface|record)\\s+${escapeRegExp(owner.name)}\\b`, "u")
        .exec(file.content);
    if (declaration?.index === undefined) {
        return undefined;
    }
    const bodyStart = file.content.indexOf("{", declaration.index + declaration[0].length);
    if (bodyStart < 0) {
        return undefined;
    }
    let remainder = file.content.slice(declaration.index + declaration[0].length, bodyStart).trim();
    let typeParameters: readonly string[] = [];
    if (remainder.startsWith("<")) {
        const typeParametersEnd = matchingAngleBracket(remainder, 0);
        if (typeParametersEnd === undefined) {
            return undefined;
        }
        const parameterEntries = splitTopLevelComma(remainder.slice(1, typeParametersEnd));
        typeParameters = parameterEntries
            .map((parameter) => /^(?:@[A-Za-z_$][\w.$]*\s+)*([A-Za-z_$][\w$]*)/u.exec(parameter)?.[1])
            .filter((parameter): parameter is string => parameter !== undefined);
        if (typeParameters.length !== parameterEntries.length || new Set(typeParameters).size !== typeParameters.length) {
            return undefined;
        }
        remainder = remainder.slice(typeParametersEnd + 1);
    }
    const clause = (
        keyword: "extends" | "implements",
        endKeywords: readonly string[],
    ): readonly JavaTypeReference[] | undefined => {
        const startMatch = new RegExp(`\\b${keyword}\\b`, "u").exec(remainder);
        if (startMatch?.index === undefined) {
            return [];
        }
        const valueStart = startMatch.index + startMatch[0].length;
        const valueEnd = endKeywords
            .map((endKeyword) => new RegExp(`\\b${endKeyword}\\b`, "u").exec(remainder.slice(valueStart))?.index)
            .filter((index): index is number => index !== undefined)
            .reduce((minimum, index) => Math.min(minimum, valueStart + index), remainder.length);
        const entries = splitTopLevelComma(remainder.slice(valueStart, valueEnd));
        const references = entries.map(parseJavaTypeReference);
        return references.every((reference): reference is JavaTypeReference => reference !== undefined)
            ? references
            : undefined;
    };
    const extendedTypes = clause("extends", ["implements", "permits"]);
    const implementedTypes = clause("implements", ["permits"]);
    if (extendedTypes === undefined || implementedTypes === undefined) {
        return undefined;
    }
    return {
        typeParameters,
        superTypes: [...extendedTypes, ...implementedTypes],
    };
};

const substituteJavaTypes = (value: string, substitutions: ReadonlyMap<string, string>): string =>
    [...substitutions.entries()].reduce(
        (current, [parameter, replacement]) => current.replace(new RegExp(`\\b${escapeRegExp(parameter)}\\b`, "gu"), replacement),
        value,
    );

const javaReferenceMatchesOwner = (
    file: CommittedSourceFile,
    reference: JavaTypeReference,
    owner: SymbolCandidate,
): boolean => reference.qualifiedOrSimpleName.includes(".")
    ? reference.qualifiedOrSimpleName === owner.identity.qualifiedName
    : reference.qualifiedOrSimpleName === owner.name && javaFileImportsOwner(file, owner);

/**
 * 从方法声明所属类型向派生类型遍历显式 Java 继承图，并逐边组合泛型替换。
 * 覆盖、循环、超深与冲突路径会停止相应推导，调用方只能消费返回的安全子集。
 */
const findJavaMethodOwners = (
    target: SymbolCandidate,
    files: readonly CommittedSourceFile[],
    repositorySymbols: readonly SymbolCandidate[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): JavaMethodOwner[] => {
    const ownerQualifiedName = target.identity.qualifiedName.split("#")[0];
    if (ownerQualifiedName === undefined || !target.identity.qualifiedName.includes("#")) {
        return [];
    }
    const directOwner = repositorySymbols.find((candidate) => candidate.revision === "head"
        && candidate.identity.language === "java"
        && candidate.identity.qualifiedName === ownerQualifiedName
        && ["class", "interface", "record"].includes(candidate.identity.signature ?? ""));
    const directFile = directOwner === undefined ? undefined : files.find((file) => file.path === directOwner.path);
    const directDefinition = directOwner === undefined || directFile === undefined
        ? undefined
        : readJavaTypeDefinition(directFile, directOwner);
    if (directOwner === undefined || directDefinition === undefined) {
        return [];
    }
    const directSubstitutions = new Map(directDefinition.typeParameters.map((parameter) => [parameter, parameter]));
    const direct: JavaMethodOwner = {
        owner: directOwner,
        typeParameters: directDefinition.typeParameters,
        substitutions: directSubstitutions,
    };
    const owners = [direct];
    const mappingKey = (substitutions: ReadonlyMap<string, string>): string =>
        JSON.stringify([...substitutions.entries()].sort(([left], [right]) => left.localeCompare(right)));
    const visited = new Map([[directOwner.identity.stableId, mappingKey(directSubstitutions)]]);
    const pending: {state: JavaMethodOwner; depth: number; ancestors: ReadonlySet<string>}[] = [{
        state: direct,
        depth: 0,
        ancestors: new Set([directOwner.identity.stableId]),
    }];
    let ambiguousInheritance = false;
    while (pending.length > 0) {
        const current = pending.shift();
        if (current === undefined) {
            continue;
        }
        for (const candidate of repositorySymbols.filter((symbol) => symbol.revision === "head"
            && symbol.identity.language === "java"
            && ["class", "interface", "record"].includes(symbol.identity.signature ?? "")
            && symbol.identity.stableId !== current.state.owner.identity.stableId)) {
            const file = files.find((source) => source.path === candidate.path);
            const definition = file === undefined ? undefined : readJavaTypeDefinition(file, candidate);
            if (file === undefined || definition === undefined) {
                continue;
            }
            const references = definition.superTypes.filter((reference) =>
                javaReferenceMatchesOwner(file, reference, current.state.owner));
            if (references.length === 0) {
                continue;
            }
            if (references.length !== 1) {
                ambiguousInheritance = true;
                limitations.add("generic-substitution-unavailable");
                continue;
            }
            if (current.ancestors.has(candidate.identity.stableId)) {
                ambiguousInheritance = true;
                limitations.add("inheritance-cycle-unavailable");
                continue;
            }
            if (current.depth >= 4) {
                limitations.add("inheritance-depth-unavailable");
                continue;
            }
            const reference = references[0] as JavaTypeReference;
            const currentParameters = current.state.typeParameters;
            const edgeSubstitutions = new Map<string, string>();
            if (currentParameters.length > 0 && reference.typeArguments.length === 0) {
                limitations.add("generic-substitution-unavailable");
                for (const parameter of currentParameters) {
                    edgeSubstitutions.set(parameter, "unknown");
                }
            } else if (reference.typeArguments.length !== currentParameters.length) {
                limitations.add("generic-substitution-unavailable");
                continue;
            } else {
                currentParameters.forEach((parameter, index) => {
                    edgeSubstitutions.set(parameter, reference.typeArguments[index] ?? "unknown");
                });
            }
            const substitutions = new Map([...current.state.substitutions.entries()].map(([parameter, value]) => [
                parameter,
                substituteJavaTypes(value, edgeSubstitutions),
            ]));
            const targetParameterCount = splitTopLevelComma(target.identity.signature?.slice(1, -1) ?? "").length;
            const overridesTarget = repositorySymbols.some((symbol) => symbol.revision === "head"
                && symbol.identity.qualifiedName === `${candidate.identity.qualifiedName}#${target.name}`
                && symbol.identity.signature?.startsWith("(") === true
                && splitTopLevelComma(symbol.identity.signature.slice(1, -1)).length === targetParameterCount);
            if (overridesTarget) {
                limitations.add("dynamic-dispatch-unavailable");
                continue;
            }
            const key = mappingKey(substitutions);
            const previousKey = visited.get(candidate.identity.stableId);
            if (previousKey !== undefined) {
                if (previousKey !== key) {
                    ambiguousInheritance = true;
                    limitations.add("generic-substitution-unavailable");
                }
                continue;
            }
            visited.set(candidate.identity.stableId, key);
            const state: JavaMethodOwner = {
                owner: candidate,
                typeParameters: definition.typeParameters,
                substitutions,
            };
            owners.push(state);
            pending.push({
                state,
                depth: current.depth + 1,
                ancestors: new Set(current.ancestors).add(candidate.identity.stableId),
            });
        }
    }
    return ambiguousInheritance ? [direct] : owners;
};

/** 在已解析方法所有者范围内定位调用，并携带接收者对应的泛型替换供重载筛选。 */
const findImportedJavaCalls = (
    file: CommittedSourceFile,
    target: SymbolCandidate,
    methodOwners: readonly JavaMethodOwner[],
    limitations: Set<ImpactPackage["limitations"][number]>,
): LocatedCall[] => {
    const [, method] = target.identity.qualifiedName.split("#");
    if (method === undefined) {
        return [];
    }
    const importedOwners = methodOwners.filter(({owner}) => javaFileImportsOwner(file, owner));
    if (importedOwners.length === 0) {
        return [];
    }
    const receiverMappings = new Map<string, Map<string, string>[]>();
    const addReceiver = (name: string, substitutions: ReadonlyMap<string, string>): void => {
        const existing = receiverMappings.get(name) ?? [];
        const key = JSON.stringify([...substitutions.entries()].sort(([left], [right]) => left.localeCompare(right)));
        if (!existing.some((candidate) => JSON.stringify([...candidate.entries()]
            .sort(([left], [right]) => left.localeCompare(right))) === key)) {
            existing.push(new Map(substitutions));
        }
        receiverMappings.set(name, existing);
    };
    for (const methodOwner of importedOwners) {
        const ownerName = symbolName(methodOwner.owner.identity);
        addReceiver(ownerName, methodOwner.substitutions);
        const bindingPattern = new RegExp(
            `\\b${escapeRegExp(ownerName)}\\s*(?:<([^;=()]+)>)?\\s+([A-Za-z_$][\\w$]*)`,
            "gu",
        );
        for (const binding of file.content.matchAll(bindingPattern)) {
            const bindingName = binding[2];
            if (bindingName === undefined) {
                continue;
            }
            const typeArguments = binding[1] === undefined ? [] : splitTopLevelComma(binding[1]);
            const ownerBindings = new Map<string, string>();
            if (methodOwner.typeParameters.length > 0 && typeArguments.length === 0) {
                limitations.add("generic-substitution-unavailable");
                for (const parameter of methodOwner.typeParameters) {
                    ownerBindings.set(parameter, "unknown");
                }
            } else if (typeArguments.length !== methodOwner.typeParameters.length) {
                limitations.add("generic-substitution-unavailable");
                continue;
            } else {
                methodOwner.typeParameters.forEach((parameter, index) => {
                    ownerBindings.set(parameter, typeArguments[index] ?? "unknown");
                });
            }
            addReceiver(bindingName, new Map([...methodOwner.substitutions.entries()].map(([parameter, value]) => [
                parameter,
                substituteJavaTypes(value, ownerBindings),
            ])));
        }
    }
    const localValueTypes = new Map<string, string>();
    for (const binding of file.content.matchAll(/\b(String|java\.lang\.String|boolean|Boolean|byte|short|int|long|float|double|Number|Integer)\s+([A-Za-z_$][\w$]*)/gu)) {
        if (binding[1] !== undefined && binding[2] !== undefined) {
            localValueTypes.set(binding[2], binding[1]);
        }
    }
    const calls: LocatedCall[] = [];
    const cursor = javaParser.parse(file.content).cursor();
    do {
        if (cursor.name !== "MethodInvocation" && cursor.name !== "ObjectCreationExpression") {
            continue;
        }
        const invocation = file.content.slice(cursor.from, cursor.to);
        const matchingSubstitutions = [...receiverMappings.entries()]
            .filter(([receiver]) => new RegExp(
                `\\b${escapeRegExp(receiver)}\\s*\\.\\s*${escapeRegExp(method)}\\s*\\(`,
                "u",
            ).test(invocation))
            .flatMap(([, substitutions]) => substitutions);
        const distinctSubstitutions = new Map(matchingSubstitutions.map((substitutions) => [
            JSON.stringify([...substitutions.entries()].sort(([left], [right]) => left.localeCompare(right))),
            substitutions,
        ]));
        if (distinctSubstitutions.size === 1) {
            const argumentsText = invocation.slice(invocation.indexOf("(") + 1, invocation.lastIndexOf(")")).trim();
            const arguments_ = argumentsText === "" ? [] : splitTopLevelComma(argumentsText);
            const substitutions = [...distinctSubstitutions.values()][0] as ReadonlyMap<string, string>;
            calls.push({
                line: file.content.slice(0, cursor.from).split(/\r?\n/u).length,
                argumentCount: arguments_.length,
                argumentTypes: arguments_.map((argument) => {
                    const value = argument.trim();
                    return /^"|^'/u.test(value)
                        ? "String"
                        : /^-?\d+(?:\.\d+)?[dDfFlL]?$/u.test(value)
                            ? "number"
                            : /^(?:true|false)$/u.test(value)
                                ? "boolean"
                                : localValueTypes.get(value) ?? "unknown";
                }),
                javaTypeSubstitutions: [...substitutions.entries()],
            });
        } else if (distinctSubstitutions.size > 1) {
            limitations.add("generic-substitution-unavailable");
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
                : findImportedJavaCalls(file, target, javaMethodOwners, limitations);
            for (const call of calls) {
                const signature = target.identity.signature;
                if (signature?.startsWith("(") === true) {
                    const javaSubstitutions = new Map(call.javaTypeSubstitutions ?? []);
                    const overloads = [...new Map(repositorySymbols
                        .filter((candidate) => candidate.revision === "head"
                            && candidate.identity.qualifiedName === target.identity.qualifiedName
                            && candidate.identity.signature?.startsWith("(") === true)
                        .map((candidate) => [candidate.identity.stableId, candidate])).values()];
                    const compatible = overloads.filter((candidate) => {
                        const candidateSignature = candidate.identity.signature === undefined
                            ? undefined
                            : substituteJavaTypes(candidate.identity.signature, javaSubstitutions);
                        const parameters = candidateSignature?.slice(1, -1);
                        return (parameters === "" ? 0 : splitTopLevelComma(parameters ?? "").length) === call.argumentCount;
                    });
                    const typeCompatible = compatible.length <= 1 ? compatible : compatible.filter((candidate) => {
                        const candidateSignature = candidate.identity.signature === undefined
                            ? undefined
                            : substituteJavaTypes(candidate.identity.signature, javaSubstitutions);
                        const parameters = splitTopLevelComma(candidateSignature?.slice(1, -1) ?? "");
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
        let headTypeScriptConfiguration: CommittedRevisionSourceSnapshot["typeScriptConfiguration"];
        let headTypeScriptConfigurationUnavailable = false;
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
            headTypeScriptConfigurationUnavailable = headSnapshot.typeScriptConfigurationStatus === "unavailable";
            if (headTypeScriptConfigurationUnavailable) {
                limitations.add("typescript-configuration-unavailable");
            }
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
        const typeResolver = headTypeScriptConfigurationUnavailable
            ? undefined
            : createTypeScriptTypeResolver(
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
