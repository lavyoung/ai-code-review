import type {RepositoryFileClassification} from "../model/repository-file-classification.js";

const documentationPath = /^(?:docs?|examples?)\//i;
const markdownFile = /(?:^|\/)readme(?:\.[^/]+)?$|\.mdx?$/i;
const githubWorkflowPath = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const githubWorkflowTemplatePath = /^\.github\/workflow-templates\/[^/]+\.ya?ml$/i;
const configurationFile = /(?:^|\/)(?:\.gitlab-ci|azure-pipelines)(?:\.[^/]+)?$|\.(?:ya?ml|json|toml|groovy)$/i;

/**
 * 仅凭仓库入口约定和路径分类文件；绝不因文本出现 `uses` 或 `steps` 而认定文件可执行。
 *
 * @param path Git 仓库相对路径。
 * @returns 不带文件内容的安全分类及可达性结论。
 */
export const classifyRepositoryFile = (path: string): RepositoryFileClassification => {
    const normalizedPath = path.replaceAll("\\", "/").replace(/^\.\//, "");

    if (githubWorkflowPath.test(normalizedPath)) {
        return {
            path: normalizedPath,
            kind: "executable-automation",
            reachability: "active",
            reasons: ["github-actions-workflow-path"],
        };
    }

    if (githubWorkflowTemplatePath.test(normalizedPath)) {
        return {
            path: normalizedPath,
            kind: "automation-template",
            reachability: "unknown",
            reasons: ["github-actions-template-path"],
        };
    }

    if (documentationPath.test(normalizedPath)) {
        return {
            path: normalizedPath,
            kind: "documentation-example",
            reachability: "inactive",
            reasons: ["documentation-path"],
        };
    }

    if (markdownFile.test(normalizedPath)) {
        return {
            path: normalizedPath,
            kind: "documentation-example",
            reachability: "inactive",
            reasons: ["markdown-file"],
        };
    }

    return {
        path: normalizedPath,
        kind: "unknown-configuration",
        reachability: "unknown",
        reasons: [configurationFile.test(normalizedPath)
            ? "configuration-file-extension"
            : "unrecognized-path"],
    };
};
