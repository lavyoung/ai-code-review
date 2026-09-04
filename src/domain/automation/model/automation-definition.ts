import type {ReviewFact} from "../../review/model/review-candidate.js";
import type {AutomationReachability, RepositoryFileClassification} from "./repository-file-classification.js";

/** 跨平台自动化定义的来源；正文绝不进入领域对象、日志或模型输入。 */
export interface AutomationSource {
    classification: RepositoryFileClassification;
    parseStatus: "parsed" | "invalid" | "resource-limit" | "not-applicable";
}

/** 已知或未知的自动化触发器。 */
export interface AutomationTrigger {
    name: string;
}

/** 平台权限以字符串保留，避免将平台专有权限放入领域策略。 */
export interface PermissionGrant {
    name: string;
    access: "read" | "write" | "none" | "unknown";
}

export interface AutomationStep {
    kind: "action" | "script" | "unknown";
    reference?: string;
}

export interface AutomationJob {
    id: string;
    permissions: readonly PermissionGrant[];
    trustBoundary: "trusted" | "untrusted" | "mixed" | "unknown";
    steps: readonly AutomationStep[];
}

export interface ExternalReference {
    kind: "action" | "reusable-workflow" | "container" | "plugin" | "script";
    reference: string;
    immutability: "pinned" | "mutable" | "unknown";
}

/** 供平台无关规则读取的只读自动化配置中间表示。 */
export interface AutomationDefinition {
    platformId: string;
    source: AutomationSource;
    reachability: AutomationReachability;
    capabilities: readonly ("external-action" | "reusable-workflow" | "script")[];
    platformFacts: readonly ReviewFact[];
    triggers: readonly AutomationTrigger[];
    jobs: readonly AutomationJob[];
    externalReferences: readonly ExternalReference[];
}
