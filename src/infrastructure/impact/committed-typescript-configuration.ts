import {posix as pathTools} from "node:path";
import * as ts from "@typescript/typescript6";
import type {CommittedRevisionSourceSnapshot} from "../../application/review/ports/committed-revision-source-port.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";

export const MAX_TYPESCRIPT_CONFIG_DEPTH = 4;
export const MAX_TYPESCRIPT_CONFIG_FILES = 8;
export const MAX_TYPESCRIPT_CONFIG_CHARS = 512 * 1024;

export type CommittedTypeScriptConfiguration = NonNullable<
    CommittedRevisionSourceSnapshot["typeScriptConfiguration"]
>;

const nodeModulesPath = /(?:^|\/)node_modules(?:\/|$)/u;
const canonicalPath = (path: string): string => path.replaceAll("\\", "/");

const isSafeConfigurationPath = (path: string): boolean => !path.startsWith("/")
    && path !== ".."
    && !path.startsWith("../")
    && !path.includes("/../")
    && !nodeModulesPath.test(path)
    && !isSensitiveFile({path, status: "modified"});

/** 只解析仓库内相对 JSON 配置引用；包名、绝对路径和 node_modules 均不进入候选集。 */
export const resolveCommittedTypeScriptConfigurationReference = (
    currentPath: string,
    reference: string,
    committedPaths: ReadonlySet<string>,
    kind: "extends" | "project" = "extends",
): string | undefined => {
    if ((!reference.startsWith("./") && !reference.startsWith("../"))
        || reference.includes("\\")
        || pathTools.isAbsolute(reference)) {
        return undefined;
    }
    const normalized = pathTools.normalize(pathTools.join(pathTools.dirname(currentPath), reference));
    if (!isSafeConfigurationPath(normalized)) {
        return undefined;
    }
    const candidates = (reference.endsWith(".json")
        ? [normalized]
        : kind === "project"
            ? [`${normalized}/tsconfig.json`, `${normalized}.json`]
            : [`${normalized}.json`, `${normalized}/tsconfig.json`])
        .map((candidate) => pathTools.normalize(candidate));
    return candidates.find((candidate) => isSafeConfigurationPath(candidate) && committedPaths.has(candidate));
};

const parseConfiguration = (path: string, content: string): Record<string, unknown> | undefined => {
    const parsed = ts.parseConfigFileTextToJson(path, content);
    return parsed.error === undefined && parsed.config !== undefined
        ? parsed.config as Record<string, unknown>
        : undefined;
};

/** 从 JSONC 配置中读取合法的 extends 字符串；语义错误由最终合并阶段统一降级。 */
export const readCommittedTypeScriptExtendsReferences = (
    path: string,
    content: string,
): readonly string[] => {
    const configuration = parseConfiguration(path, content);
    if (configuration === undefined) {
        return [];
    }
    const value: unknown = configuration.extends;
    if (typeof value === "string") {
        return [value];
    }
    return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
        ? value
        : [];
};

/** 从配置中读取 project references；非法结构由最终配置图解析统一判为不可用。 */
export const readCommittedTypeScriptProjectReferences = (
    path: string,
    content: string,
): readonly string[] => {
    const configuration = parseConfiguration(path, content);
    const value = configuration?.references;
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) && value.every((entry): entry is {path: string} =>
        typeof entry === "object"
        && entry !== null
        && typeof (entry as {path?: unknown}).path === "string")
        ? value.map((entry) => entry.path)
        : [];
};

/** 一个已验证配置图节点；directory 用于为源码选择最具体的项目配置。 */
export interface ResolvedCommittedTypeScriptProject {
    configurationPath: string;
    directory: string;
    options: ts.CompilerOptions;
}

/**
 * 合并已提交的受控 TypeScript 配置链。
 *
 * 任一父/项目配置缺失、循环、越界、目录归属歧义或配置诊断时整体返回不可用；
 * 调用方仍可继续不依赖类型检查器的语法分析。
 */
export const resolveCommittedTypeScriptProjects = (
    configuration: CommittedTypeScriptConfiguration,
): readonly ResolvedCommittedTypeScriptProject[] | undefined => {
    const configurationFiles = [configuration, ...(configuration.supportingConfigurations ?? [])];
    if (configurationFiles.length > MAX_TYPESCRIPT_CONFIG_FILES
        || configurationFiles.reduce((total, entry) => total + entry.content.length, 0) > MAX_TYPESCRIPT_CONFIG_CHARS) {
        return undefined;
    }
    const configurations = new Map(configurationFiles.map((entry) => [canonicalPath(entry.path), {
        path: canonicalPath(entry.path),
        content: entry.content,
    }]));
    if (configurations.size !== configurationFiles.length
        || [...configurations.keys()].some((path) => !isSafeConfigurationPath(path))) {
        return undefined;
    }

    const resolve = (
        path: string,
        visiting: ReadonlySet<string>,
        depth: number,
    ): ts.CompilerOptions | undefined => {
        const input = configurations.get(path);
        if (input === undefined || visiting.has(path) || depth > MAX_TYPESCRIPT_CONFIG_DEPTH) {
            return undefined;
        }
        const parsedConfiguration = parseConfiguration(path, input.content);
        if (parsedConfiguration === undefined) {
            return undefined;
        }
        const extendsValue: unknown = parsedConfiguration.extends;
        const references = extendsValue === undefined
            ? []
            : typeof extendsValue === "string"
                ? [extendsValue]
                : Array.isArray(extendsValue) && extendsValue.every((entry): entry is string => typeof entry === "string")
                    ? extendsValue
                    : undefined;
        if (references === undefined || (depth === MAX_TYPESCRIPT_CONFIG_DEPTH && references.length > 0)) {
            return undefined;
        }
        const nextVisiting = new Set(visiting).add(path);
        let inherited: ts.CompilerOptions = {};
        for (const reference of references) {
            const parentPath = resolveCommittedTypeScriptConfigurationReference(
                path,
                reference,
                new Set(configurations.keys()),
            );
            if (parentPath === undefined) {
                return undefined;
            }
            const parentOptions = resolve(parentPath, nextVisiting, depth + 1);
            if (parentOptions === undefined) {
                return undefined;
            }
            inherited = {...inherited, ...parentOptions};
        }
        const directory = pathTools.dirname(path);
        const converted = ts.convertCompilerOptionsFromJson(
            parsedConfiguration.compilerOptions ?? {},
            `/repo/${directory === "." ? "" : directory}`,
        );
        return converted.errors.length === 0 ? {...inherited, ...converted.options} : undefined;
    };

    const projects = new Map<string, ResolvedCommittedTypeScriptProject>();
    const completedProjects = new Set<string>();
    const staysWithinProjectDirectory = (directory: string, value: string): boolean => {
        if (value.includes("\\") || pathTools.isAbsolute(value)) {
            return false;
        }
        const resolved = pathTools.normalize(pathTools.join(directory, value));
        return resolved === directory || resolved.startsWith(`${directory}/`);
    };
    const visitProject = (path: string, visiting: ReadonlySet<string>, depth: number): boolean => {
        if (visiting.has(path) || depth > MAX_TYPESCRIPT_CONFIG_DEPTH) {
            return false;
        }
        if (completedProjects.has(path)) {
            return true;
        }
        const input = configurations.get(path);
        const parsedConfiguration = input === undefined ? undefined : parseConfiguration(path, input.content);
        const options = resolve(path, new Set(), 0);
        if (parsedConfiguration === undefined || options === undefined) {
            return false;
        }
        const directory = pathTools.dirname(path);
        if (path !== "tsconfig.json" && directory === ".") {
            return false;
        }
        if (path !== "tsconfig.json") {
            const configuredSources = [parsedConfiguration.files, parsedConfiguration.include]
                .filter((value) => value !== undefined);
            if (options.composite !== true
                || configuredSources.some((value) => !Array.isArray(value)
                    || !value.every((entry) => typeof entry === "string"
                        && staysWithinProjectDirectory(directory, entry)))) {
                return false;
            }
            const projectDirectory = `/repo/${directory}`;
            if ((options.rootDir !== undefined
                    && options.rootDir !== projectDirectory
                    && !options.rootDir.startsWith(`${projectDirectory}/`))
                || options.rootDirs?.some((rootDirectory) => rootDirectory !== projectDirectory
                    && !rootDirectory.startsWith(`${projectDirectory}/`)) === true) {
                return false;
            }
        }
        const referencesValue = parsedConfiguration.references;
        const references = referencesValue === undefined
            ? []
            : Array.isArray(referencesValue) && referencesValue.every((entry): entry is {path: string} =>
                typeof entry === "object"
                && entry !== null
                && typeof (entry as {path?: unknown}).path === "string")
                ? referencesValue.map((entry) => entry.path)
                : undefined;
        if (references === undefined || (depth === MAX_TYPESCRIPT_CONFIG_DEPTH && references.length > 0)) {
            return false;
        }
        const nextVisiting = new Set(visiting).add(path);
        const valid = references.every((reference) => {
            const projectPath = resolveCommittedTypeScriptConfigurationReference(
                path,
                reference,
                new Set(configurations.keys()),
                "project",
            );
            return projectPath !== undefined && visitProject(projectPath, nextVisiting, depth + 1);
        });
        if (!valid) {
            return false;
        }
        completedProjects.add(path);
        const hasNoConfiguredSources = Array.isArray(parsedConfiguration.files)
            && parsedConfiguration.files.length === 0
            && (parsedConfiguration.include === undefined
                || (Array.isArray(parsedConfiguration.include) && parsedConfiguration.include.length === 0));
        if (!hasNoConfiguredSources) {
            projects.set(path, {configurationPath: path, directory, options});
        }
        return true;
    };

    if (!visitProject("tsconfig.json", new Set(), 0)) {
        return undefined;
    }
    const resolvedProjects = [...projects.values()];
    return new Set(resolvedProjects.map((project) => project.directory)).size === resolvedProjects.length
        ? resolvedProjects
        : undefined;
};
