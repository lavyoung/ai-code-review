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
    const candidates = reference.endsWith(".json")
        ? [normalized]
        : [`${normalized}.json`, `${normalized}/tsconfig.json`];
    return candidates.find((candidate) => isSafeConfigurationPath(candidate) && committedPaths.has(candidate));
};

/** 从 JSONC 配置中读取合法的 extends 字符串；语义错误由最终合并阶段统一降级。 */
export const readCommittedTypeScriptExtendsReferences = (
    path: string,
    content: string,
): readonly string[] => {
    const parsed = ts.parseConfigFileTextToJson(path, content);
    if (parsed.error !== undefined || parsed.config === undefined) {
        return [];
    }
    const value: unknown = parsed.config.extends;
    if (typeof value === "string") {
        return [value];
    }
    return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
        ? value
        : [];
};

/**
 * 合并已提交的受控 TypeScript 配置链。
 *
 * 任一父配置缺失、循环、越界、包含 project references 或配置诊断时整体返回不可用；
 * 调用方仍可继续不依赖类型检查器的语法分析。
 */
export const resolveCommittedTypeScriptCompilerOptions = (
    configuration: CommittedTypeScriptConfiguration,
): ts.CompilerOptions | undefined => {
    const configurationFiles = [configuration, ...(configuration.extendedConfigurations ?? [])];
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
        const parsed = ts.parseConfigFileTextToJson(path, input.content);
        if (parsed.error !== undefined || parsed.config === undefined || parsed.config.references !== undefined) {
            return undefined;
        }
        const extendsValue: unknown = parsed.config.extends;
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
            parsed.config.compilerOptions ?? {},
            `/repo/${directory === "." ? "" : directory}`,
        );
        return converted.errors.length === 0 ? {...inherited, ...converted.options} : undefined;
    };

    return resolve("tsconfig.json", new Set(), 0);
};
