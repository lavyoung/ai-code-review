import {createHash} from "node:crypto";
import {parseDocument} from "yaml";
import type {
    AutomationDefinition,
    AutomationJob,
    AutomationStep,
    AutomationTrigger,
    ExternalReference,
    PermissionGrant,
} from "../../../domain/automation/model/automation-definition.js";
import type {AutomationReachability} from "../../../domain/automation/model/repository-file-classification.js";
import type {ReviewFact} from "../../../domain/review/model/review-candidate.js";
import type {
    AutomationParseRequest,
    AutomationParseResult,
    AutomationParserAdapter,
} from "../../../application/review/ports/automation-parser-adapter.js";

const MAX_WORKFLOW_BYTES = 256 * 1024;
const MAX_YAML_ALIASES = 32;
const MAX_YAML_DEPTH = 32;
const immutableGitReference = /@[0-9a-f]{40}$/i;
const immutableContainerReference = /@sha256:[0-9a-f]{64}$/i;
const untrustedTriggerNames = new Set([
    "pull_request",
    "pull_request_target",
    "issue_comment",
    "discussion_comment",
]);
const trustedTriggerNames = new Set(["push", "schedule"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

/** `yaml` 的实体展开还会在 toJS 阶段受 maxAliasCount 保护。 */
const hasTooManyYamlAliases = (content: string): boolean =>
    (content.match(/(?:^|[\s,[{])[*&][A-Za-z0-9_-]+/g)?.length ?? 0) > MAX_YAML_ALIASES;

const exceedsMaximumDepth = (value: unknown, depth = 0): boolean => {
    if (depth > MAX_YAML_DEPTH) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some((item) => exceedsMaximumDepth(item, depth + 1));
    }
    return Object.values(asRecord(value) ?? {}).some((item) => exceedsMaximumDepth(item, depth + 1));
};

const factId = (path: string, suffix: string): string =>
    `automation:${createHash("sha256").update(path).digest("hex").slice(0, 16)}:${suffix}`;

const createFact = (
    path: string,
    suffix: string,
    kind: ReviewFact["kind"],
): ReviewFact => ({
    id: factId(path, suffix),
    kind,
    source: "automation-parser",
    verification: "confirmed",
});

const toTriggers = (value: unknown): AutomationTrigger[] => {
    if (typeof value === "string") {
        return [{name: value}];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => typeof item === "string" ? [{name: item}] : []);
    }

    return Object.keys(asRecord(value) ?? {}).map((name) => ({name}));
};

const toPermissions = (value: unknown): PermissionGrant[] => {
    if (value === "read-all" || value === "write-all") {
        return [{name: "*", access: value === "read-all" ? "read" : "write"}];
    }
    if (value === "{}") {
        return [];
    }

    return Object.entries(asRecord(value) ?? {}).map(([name, access]) => ({
        name,
        access: access === "read" || access === "write" || access === "none" ? access : "unknown",
    }));
};

const toTrustBoundary = (triggers: readonly AutomationTrigger[]): AutomationJob["trustBoundary"] => {
    const names = new Set(triggers.map((trigger) => trigger.name));
    const hasUntrusted = [...names].some((name) => untrustedTriggerNames.has(name));
    const hasTrusted = [...names].some((name) => trustedTriggerNames.has(name));

    if (hasUntrusted && hasTrusted) {
        return "mixed";
    }
    if (hasUntrusted) {
        return "untrusted";
    }
    if (hasTrusted) {
        return "trusted";
    }
    return "unknown";
};

const toImmutability = (reference: string): ExternalReference["immutability"] => {
    if (reference.startsWith("./")) {
        return "unknown";
    }
    if (immutableGitReference.test(reference) || immutableContainerReference.test(reference)) {
        return "pinned";
    }
    return reference.includes("@") || reference.includes(":") ? "mutable" : "unknown";
};

const deduplicateReferences = (references: readonly ExternalReference[]): ExternalReference[] => [...new Map(
    references.map((reference) => [`${reference.kind}:${reference.reference}`, reference]),
).values()];

/**
 * GitHub Actions 的只读 YAML 解析器。
 *
 * 它只读取受限大小的 YAML 数据，不执行表达式、脚本或工作流；所有平台含义都先转换为通用 IR。
 */
export class GitHubActionsAutomationParser implements AutomationParserAdapter {
    public readonly platformId = "github-actions";

    public parse(request: AutomationParseRequest): AutomationParseResult {
        if (request.classification.kind !== "executable-automation"
            && request.classification.kind !== "automation-template") {
            return {status: "not-applicable"};
        }
        if (Buffer.byteLength(request.content, "utf8") > MAX_WORKFLOW_BYTES) {
            return {status: "resource-limit"};
        }
        if (hasTooManyYamlAliases(request.content)) {
            return {status: "resource-limit"};
        }

        let data: Record<string, unknown> | undefined;
        try {
            const document = parseDocument(request.content, {
                prettyErrors: false,
                strict: true,
            });
            if (document.errors.length > 0) {
                return {status: "invalid"};
            }
            data = asRecord(document.toJS({maxAliasCount: MAX_YAML_ALIASES}));
        } catch {
            return {status: "invalid"};
        }
        if (data === undefined) {
            return {status: "invalid"};
        }
        if (exceedsMaximumDepth(data)) {
            return {status: "resource-limit"};
        }

        const triggers = toTriggers(data.on);
        const workflowPermissions = toPermissions(data.permissions);
        const jobs = this.toJobs(data.jobs, triggers, workflowPermissions);
        const externalReferences = deduplicateReferences([
            ...jobs.flatMap((job) => job.steps.flatMap((step) => step.kind === "action" && step.reference !== undefined
                ? [{kind: "action" as const, reference: step.reference, immutability: toImmutability(step.reference)}]
                : [])),
            ...this.toReusableWorkflowReferences(data.jobs),
            ...this.toContainerReferences(data.jobs),
        ]);
        const capabilities = new Set<AutomationDefinition["capabilities"][number]>();
        if (jobs.some((job) => job.steps.some((step) => step.kind === "script"))) {
            capabilities.add("script");
        }
        if (externalReferences.some((reference) => reference.kind === "action")) {
            capabilities.add("external-action");
        }
        if (externalReferences.some((reference) => reference.kind === "reusable-workflow")) {
            capabilities.add("reusable-workflow");
        }

        const definition: AutomationDefinition = {
            platformId: this.platformId,
            source: {
                classification: request.classification,
                parseStatus: "parsed",
            },
            reachability: request.classification.reachability,
            capabilities: [...capabilities],
            platformFacts: [
                createFact(request.path, "parsed", "automation-parse"),
                ...triggers.map((_, index) => createFact(request.path, `trigger-${index}`, "automation-trigger")),
                ...jobs.flatMap((job) => job.permissions.map((_, index) =>
                    createFact(request.path, `permission-${job.id}-${index}`, "automation-permission"))),
                ...externalReferences.map((_, index) =>
                    createFact(request.path, `reference-${index}`, "automation-external-reference")),
            ],
            triggers,
            jobs,
            externalReferences,
        };

        return {status: "parsed", definition};
    }

    private toJobs(
        value: unknown,
        triggers: readonly AutomationTrigger[],
        workflowPermissions: readonly PermissionGrant[],
    ): AutomationJob[] {
        return Object.entries(asRecord(value) ?? {}).flatMap(([id, jobValue]) => {
            const job = asRecord(jobValue);
            if (job === undefined) {
                return [];
            }
            const jobPermissions = toPermissions(job.permissions);
            const steps = (Array.isArray(job.steps) ? job.steps : []).flatMap((stepValue): AutomationStep[] => {
                const step = asRecord(stepValue);
                if (step === undefined) {
                    return [{kind: "unknown"}];
                }
                const actionReference = asString(step.uses);
                if (actionReference !== undefined) {
                    return [{kind: "action", reference: actionReference}];
                }
                return step.run === undefined ? [{kind: "unknown"}] : [{kind: "script"}];
            });

            return [{
                id,
                permissions: jobPermissions.length > 0 ? jobPermissions : workflowPermissions,
                trustBoundary: toTrustBoundary(triggers),
                steps,
            }];
        });
    }

    private toReusableWorkflowReferences(value: unknown): ExternalReference[] {
        return Object.values(asRecord(value) ?? {}).flatMap((jobValue) => {
            const reference = asString(asRecord(jobValue)?.uses);
            return reference === undefined
                ? []
                : [{
                    kind: "reusable-workflow" as const,
                    reference,
                    immutability: toImmutability(reference),
                }];
        });
    }

    private toContainerReferences(value: unknown): ExternalReference[] {
        return Object.values(asRecord(value) ?? {}).flatMap((jobValue) => {
            const reference = asString(asRecord(jobValue)?.container);
            return reference === undefined
                ? []
                : [{
                    kind: "container" as const,
                    reference,
                    immutability: toImmutability(reference),
                }];
        });
    }
}
