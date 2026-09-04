import type {AutomationDefinition} from "./automation-definition.js";

/** 已解析工作流及其同仓库复用工作流的受限可达性图。 */
export interface AutomationDefinitionGraph {
    root: AutomationDefinition;
    reachableDefinitions: readonly AutomationDefinition[];
    unavailableReferenceCount: number;
    cycleCount: number;
    depthLimitHit: boolean;
    definitionLimitHit: boolean;
}
