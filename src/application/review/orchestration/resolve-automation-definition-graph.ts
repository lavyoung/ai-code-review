import type {AutomationDefinitionGraph} from "../../../domain/automation/model/automation-definition-graph.js";
import type {AutomationDefinition} from "../../../domain/automation/model/automation-definition.js";
import {classifyRepositoryFile} from "../../../domain/automation/policy/classify-repository-file.js";
import type {CommittedFileReader} from "../ports/committed-file-reader.js";
import type {AutomationParserRegistry} from "../ports/automation-parser-adapter.js";

const MAX_REUSABLE_WORKFLOW_DEPTH = 8;
const MAX_REACHABLE_DEFINITIONS = 16;

const toLocalRepositoryPath = (reference: string): string | undefined => {
    if (!reference.startsWith("./")) {
        return undefined;
    }
    const path = reference.slice(2).replaceAll("\\", "/");
    return path.length === 0 || path.split("/").includes("..") ? undefined : path;
};

export interface ResolveAutomationDefinitionGraphCommand {
    platformId: string;
    rootPath: string;
    rootContent: string;
    signal: AbortSignal;
}

export interface AutomationDefinitionGraphResolution {
    graph?: AutomationDefinitionGraph;
    parseStatus: "parsed" | "invalid" | "resource-limit" | "not-applicable";
}

/**
 * 解析同仓库复用工作流的有界图，不跟随远程引用，也不执行任何配置。
 *
 * 被引用但没有本次变更的定义只供上下文使用；调用方不得将其作为报告定位。
 */
export const resolveAutomationDefinitionGraph = async (
    command: ResolveAutomationDefinitionGraphCommand,
    dependencies: {
        committedFileReader: CommittedFileReader;
        automationParserRegistry: AutomationParserRegistry;
    },
): Promise<AutomationDefinitionGraphResolution> => {
    const parser = dependencies.automationParserRegistry.resolve(command.platformId);
    if (parser === undefined) {
        return {parseStatus: "not-applicable"};
    }
    const rootClassification = classifyRepositoryFile(command.rootPath);
    const parsedRoot = parser.parse({
        path: command.rootPath,
        content: command.rootContent,
        classification: rootClassification,
    });
    if (parsedRoot.definition === undefined) {
        return {parseStatus: parsedRoot.status};
    }

    const reachableDefinitions: AutomationDefinition[] = [parsedRoot.definition];
    const visited = new Set([rootClassification.path]);
    const visiting = new Set([rootClassification.path]);
    let unavailableReferenceCount = 0;
    let cycleCount = 0;
    let depthLimitHit = false;
    let definitionLimitHit = false;

    const visit = async (definition: AutomationDefinition, depth: number): Promise<void> => {
        for (const reference of definition.externalReferences) {
            if (reference.kind !== "reusable-workflow") {
                continue;
            }
            const localPath = toLocalRepositoryPath(reference.reference);
            if (localPath === undefined) {
                continue;
            }
            if (visiting.has(localPath)) {
                cycleCount += 1;
                continue;
            }
            if (visited.has(localPath)) {
                continue;
            }
            if (depth >= MAX_REUSABLE_WORKFLOW_DEPTH) {
                depthLimitHit = true;
                continue;
            }
            if (reachableDefinitions.length >= MAX_REACHABLE_DEFINITIONS) {
                definitionLimitHit = true;
                continue;
            }

            const classification = classifyRepositoryFile(localPath);
            if (classification.reachability !== "active") {
                unavailableReferenceCount += 1;
                continue;
            }
            const content = await dependencies.committedFileReader.readHeadFile(localPath, command.signal);
            if (content === undefined) {
                unavailableReferenceCount += 1;
                continue;
            }
            const parsed = parser.parse({path: localPath, content, classification});
            if (parsed.definition === undefined) {
                unavailableReferenceCount += 1;
                continue;
            }

            visited.add(localPath);
            visiting.add(localPath);
            reachableDefinitions.push(parsed.definition);
            await visit(parsed.definition, depth + 1);
            visiting.delete(localPath);
        }
    };

    await visit(parsedRoot.definition, 0);

    return {
        parseStatus: "parsed",
        graph: {
            root: parsedRoot.definition,
            reachableDefinitions,
            unavailableReferenceCount,
            cycleCount,
            depthLimitHit,
            definitionLimitHit,
        },
    };
};
