import {parseDocument} from "yaml";
import type {ContractCompatibilityChange} from "../../domain/impact/model/impact-package.js";

export type ContractKind = "openapi" | "asyncapi" | "json-schema";

interface ContractDifferenceResult {
    changes: readonly (ContractCompatibilityChange & {subject: string})[];
    complete: boolean;
}

const MAX_SCHEMA_NODES = 512;
const MAX_SCHEMA_DEPTH = 8;
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object"
    && value !== null
    && !Array.isArray(value);

const recordValue = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

const isOptionalRecord = (value: unknown): boolean => value === undefined || isRecord(value);
const isOptionalArray = (value: unknown): boolean => value === undefined || Array.isArray(value);

const parseContract = (content: string): Record<string, unknown> | undefined => {
    try {
        const document = parseDocument(content, {strict: true, uniqueKeys: true});
        if (document.errors.length > 0) {
            return undefined;
        }
        const value: unknown = document.toJS({maxAliasCount: 0});
        return isRecord(value) ? value : undefined;
    } catch {
        return undefined;
    }
};

const canonicalJsonValue = (value: unknown): unknown => isRecord(value)
    ? Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]))
    : Array.isArray(value) ? value.map(canonicalJsonValue) : value;

const stableJson = (value: unknown): string => JSON.stringify(canonicalJsonValue(value));

const versionFamily = (document: Record<string, unknown>, kind: ContractKind): string | undefined => {
    if (kind === "openapi") {
        const version = document.openapi;
        return typeof version === "string" && /^3\.(?:0|1)\.\d+(?:[-+].*)?$/u.test(version)
            ? version.split(".").slice(0, 2).join(".")
            : undefined;
    }
    if (kind === "asyncapi") {
        const version = document.asyncapi;
        return typeof version === "string" && /^(?:2|3)\.\d+\.\d+(?:[-+].*)?$/u.test(version)
            ? version.split(".")[0]
            : undefined;
    }
    const schema = document.$schema;
    if (typeof schema !== "string") {
        return undefined;
    }
    return /draft-07/u.test(schema) ? "draft-07"
        : /2019-09/u.test(schema) ? "2019-09"
            : /2020-12/u.test(schema) ? "2020-12"
                : undefined;
};

const breaking = (
    strategy: ContractCompatibilityChange["strategy"],
    rule: ContractCompatibilityChange["rule"],
    subject: string,
): ContractCompatibilityChange & {subject: string} => ({
    rulesetVersion: "v1",
    classification: "breaking",
    strategy,
    rule,
    subject,
});

const parameterMap = (value: unknown): Map<string, Record<string, unknown>> | undefined => {
    if (value === undefined) {
        return new Map();
    }
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = new Map<string, Record<string, unknown>>();
    for (const parameter of value) {
        if (!isRecord(parameter) || typeof parameter.name !== "string" || parameter.name === ""
            || typeof parameter.in !== "string"
            || !["query", "header", "path", "cookie"].includes(parameter.in)
            || parameter.$ref !== undefined
            || parameter.required !== undefined && typeof parameter.required !== "boolean"
            || parameter.in === "path" && parameter.required !== true) {
            return undefined;
        }
        const key = `${parameter.in}:${parameter.name}`;
        if (result.has(key)) {
            return undefined;
        }
        result.set(key, parameter);
    }
    return result;
};

const responseCovers = (newResponses: Record<string, unknown>, oldStatus: string): boolean =>
    oldStatus in newResponses
    || (/^2\d\d$/u.test(oldStatus) && "2XX" in newResponses);

const compareOpenApi = (
    base: Record<string, unknown>,
    head: Record<string, unknown>,
): ContractDifferenceResult => {
    const changes: (ContractCompatibilityChange & {subject: string})[] = [];
    let complete = true;
    if (!isRecord(base.paths) || !isRecord(head.paths)) {
        return {changes: [], complete: false};
    }
    const basePaths = recordValue(base.paths);
    const headPaths = recordValue(head.paths);
    for (const [path, basePathValue] of Object.entries(basePaths)) {
        if (!isRecord(basePathValue)) {
            complete = false;
            continue;
        }
        const basePath = recordValue(basePathValue);
        const headPathValue = headPaths[path];
        if (headPathValue === undefined) {
            changes.push(breaking("openapi-client-backward", "openapi-path-removed", path));
            continue;
        }
        if (!isRecord(headPathValue)) {
            complete = false;
            continue;
        }
        if (basePath.$ref !== undefined || headPathValue.$ref !== undefined) {
            complete = false;
            continue;
        }
        for (const method of HTTP_METHODS) {
            const baseOperation = basePath[method];
            if (baseOperation !== undefined && !isRecord(baseOperation)) {
                complete = false;
                continue;
            }
            if (!isRecord(baseOperation)) {
                continue;
            }
            const headOperation = headPathValue[method];
            const subject = `${path}:${method}`;
            if (headOperation === undefined) {
                changes.push(breaking("openapi-client-backward", "openapi-operation-removed", subject));
                continue;
            }
            if (!isRecord(headOperation)) {
                complete = false;
                continue;
            }
            if (!isOptionalArray(basePath.parameters)
                || !isOptionalArray(baseOperation.parameters)
                || !isOptionalArray(headPathValue.parameters)
                || !isOptionalArray(headOperation.parameters)) {
                complete = false;
                continue;
            }
            const basePathParameters = parameterMap(basePath.parameters);
            const baseOperationParameters = parameterMap(baseOperation.parameters);
            const headPathParameters = parameterMap(headPathValue.parameters);
            const headOperationParameters = parameterMap(headOperation.parameters);
            if (basePathParameters === undefined || baseOperationParameters === undefined
                || headPathParameters === undefined || headOperationParameters === undefined) {
                complete = false;
            } else {
                const baseParameters = new Map([...basePathParameters, ...baseOperationParameters]);
                const headParameters = new Map([...headPathParameters, ...headOperationParameters]);
                for (const [key, parameter] of headParameters) {
                    if (parameter.required !== true) {
                        continue;
                    }
                    const previous = baseParameters.get(key);
                    if (previous === undefined) {
                        changes.push(breaking("openapi-client-backward", "openapi-required-parameter-added", `${subject}:${key}`));
                    } else if (previous.required !== true) {
                        changes.push(breaking("openapi-client-backward", "openapi-parameter-became-required", `${subject}:${key}`));
                    }
                }
            }
            if (!isOptionalRecord(baseOperation.requestBody) || !isOptionalRecord(headOperation.requestBody)) {
                complete = false;
                continue;
            }
            const baseRequestBody = recordValue(baseOperation.requestBody);
            const headRequestBody = recordValue(headOperation.requestBody);
            if (headRequestBody.required !== undefined && typeof headRequestBody.required !== "boolean"
                || baseRequestBody.required !== undefined && typeof baseRequestBody.required !== "boolean"
                || headRequestBody.$ref !== undefined
                || baseRequestBody.$ref !== undefined) {
                complete = false;
            } else if (headRequestBody.required === true && baseRequestBody.required !== true) {
                changes.push(breaking("openapi-client-backward", "openapi-required-request-body-added", subject));
            }
            if (!isRecord(baseOperation.responses) || !isRecord(headOperation.responses)) {
                complete = false;
                continue;
            }
            const baseResponses = recordValue(baseOperation.responses);
            const headResponses = recordValue(headOperation.responses);
            for (const status of Object.keys(baseResponses).filter((candidate) => /^2(?:\d\d|XX)$/u.test(candidate))) {
                if (!responseCovers(headResponses, status)) {
                    changes.push(breaking("openapi-client-backward", "openapi-success-response-removed", `${subject}:${status}`));
                }
            }
        }
    }
    return {changes, complete};
};

const compareAsyncApi = (
    base: Record<string, unknown>,
    head: Record<string, unknown>,
    version: string,
): ContractDifferenceResult => {
    const changes: (ContractCompatibilityChange & {subject: string})[] = [];
    if (!isRecord(base.channels) || !isRecord(head.channels)) {
        return {changes: [], complete: false};
    }
    let complete = true;
    const baseChannels = recordValue(base.channels);
    const headChannels = recordValue(head.channels);
    for (const [channel, baseChannelValue] of Object.entries(baseChannels)) {
        const headChannelValue = headChannels[channel];
        if (!isRecord(baseChannelValue)) {
            complete = false;
            continue;
        }
        if (headChannelValue === undefined) {
            changes.push(breaking("asyncapi-channel-backward", "asyncapi-channel-removed", channel));
            continue;
        }
        if (!isRecord(headChannelValue)) {
            complete = false;
            continue;
        }
        if (version === "2") {
            const baseChannel = recordValue(baseChannelValue);
            for (const operation of ["publish", "subscribe"] as const) {
                if (isRecord(baseChannel[operation]) && headChannelValue[operation] === undefined) {
                    changes.push(breaking("asyncapi-channel-backward", "asyncapi-operation-removed", `${channel}:${operation}`));
                } else if (baseChannel[operation] !== undefined && !isRecord(baseChannel[operation])
                    || headChannelValue[operation] !== undefined && !isRecord(headChannelValue[operation])) {
                    complete = false;
                }
            }
        }
    }
    if (version === "3") {
        if (!isRecord(base.operations) || !isRecord(head.operations)) {
            return {changes, complete: false};
        }
        const baseOperations = recordValue(base.operations);
        const headOperations = recordValue(head.operations);
        for (const operation of Object.keys(baseOperations)) {
            if (!isRecord(baseOperations[operation])) {
                complete = false;
            } else if (!(operation in headOperations)) {
                changes.push(breaking("asyncapi-channel-backward", "asyncapi-operation-removed", operation));
            } else if (!isRecord(headOperations[operation])) {
                complete = false;
            }
        }
    }
    return {changes, complete};
};

const schemaTypes = (value: unknown): readonly string[] | undefined => typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
        ? value
        : undefined;

const typeAcceptedBy = (accepted: readonly string[], previous: string): boolean =>
    accepted.includes(previous) || (previous === "integer" && accepted.includes("number"));

const compareJsonSchema = (
    base: Record<string, unknown>,
    head: Record<string, unknown>,
): ContractDifferenceResult => {
    const changes: (ContractCompatibilityChange & {subject: string})[] = [];
    let complete = true;
    let visited = 0;
    const compare = (baseSchema: Record<string, unknown>, headSchema: Record<string, unknown>, pointer: string, depth: number): void => {
        visited += 1;
        if (visited > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) {
            complete = false;
            return;
        }
        if (baseSchema.$ref !== undefined || headSchema.$ref !== undefined) {
            complete = false;
            return;
        }
        const compositionKeywords = ["allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependentRequired"];
        if (compositionKeywords.some((keyword) => keyword in baseSchema || keyword in headSchema)) {
            complete = false;
            return;
        }
        if (!isOptionalArray(baseSchema.required) || !isOptionalArray(headSchema.required)
            || (Array.isArray(baseSchema.required) && !baseSchema.required.every((value) => typeof value === "string"))
            || (Array.isArray(headSchema.required) && !headSchema.required.every((value) => typeof value === "string"))) {
            complete = false;
            return;
        }
        const baseRequired = Array.isArray(baseSchema.required)
            ? baseSchema.required.filter((value): value is string => typeof value === "string")
            : [];
        const headRequired = Array.isArray(headSchema.required)
            ? headSchema.required.filter((value): value is string => typeof value === "string")
            : [];
        for (const property of headRequired.filter((property) => !baseRequired.includes(property))) {
            changes.push(breaking("json-schema-instance-backward", "json-schema-required-property-added", `${pointer}/required/${property}`));
        }
        const baseEnum = Array.isArray(baseSchema.enum) ? baseSchema.enum.map(stableJson) : undefined;
        const headEnum = Array.isArray(headSchema.enum) ? new Set(headSchema.enum.map(stableJson)) : undefined;
        if ((baseEnum === undefined && headEnum !== undefined)
            || (baseEnum !== undefined && headEnum !== undefined && baseEnum.some((value) => !headEnum.has(value)))) {
            changes.push(breaking("json-schema-instance-backward", "json-schema-enum-narrowed", `${pointer}/enum`));
        }
        const baseTypes = schemaTypes(baseSchema.type);
        const headTypes = schemaTypes(headSchema.type);
        if (baseSchema.type !== undefined && baseTypes === undefined
            || headSchema.type !== undefined && headTypes === undefined) {
            complete = false;
            return;
        }
        if ((baseTypes === undefined && headTypes !== undefined)
            || (baseTypes !== undefined && headTypes !== undefined
                && baseTypes.some((type) => !typeAcceptedBy(headTypes, type)))) {
            changes.push(breaking("json-schema-instance-backward", "json-schema-type-narrowed", `${pointer}/type`));
        }
        if (baseSchema.additionalProperties !== false && headSchema.additionalProperties === false) {
            changes.push(breaking("json-schema-instance-backward", "json-schema-additional-properties-disabled", `${pointer}/additionalProperties`));
        }
        if (!isOptionalRecord(baseSchema.properties) || !isOptionalRecord(headSchema.properties)) {
            complete = false;
            return;
        }
        const baseProperties = recordValue(baseSchema.properties);
        const headProperties = recordValue(headSchema.properties);
        for (const property of Object.keys(baseProperties).filter((name) => isRecord(headProperties[name]))) {
            const baseProperty = baseProperties[property];
            const headProperty = headProperties[property];
            if (isRecord(baseProperty) && isRecord(headProperty)) {
                compare(baseProperty, headProperty, `${pointer}/properties/${property}`, depth + 1);
            }
        }
    };
    compare(base, head, "#", 0);
    return {changes, complete};
};

/** 比较两个已提交契约快照；只返回 v1 规则集可确定的向后兼容破坏。 */
export const compareCommittedContracts = (
    kind: ContractKind,
    baseContent: string | undefined,
    headContent: string | undefined,
): ContractDifferenceResult => {
    const base = baseContent === undefined ? undefined : parseContract(baseContent);
    const head = headContent === undefined ? undefined : parseContract(headContent);
    if (baseContent !== undefined && base === undefined || headContent !== undefined && head === undefined) {
        return {changes: [], complete: false};
    }
    const baseVersion = base === undefined ? undefined : versionFamily(base, kind);
    const headVersion = head === undefined ? undefined : versionFamily(head, kind);
    if (base === undefined && head !== undefined) {
        return {changes: [], complete: headVersion !== undefined};
    }
    if (base !== undefined && head === undefined) {
        return baseVersion === undefined
            ? {changes: [], complete: false}
            : {changes: [breaking(
                kind === "openapi" ? "openapi-client-backward"
                    : kind === "asyncapi" ? "asyncapi-channel-backward"
                        : "json-schema-instance-backward",
                "contract-removed",
                "#",
            )], complete: true};
    }
    if (base === undefined || head === undefined || baseVersion === undefined || headVersion === undefined
        || baseVersion !== headVersion) {
        return {changes: [], complete: false};
    }
    return kind === "openapi" ? compareOpenApi(base, head)
        : kind === "asyncapi" ? compareAsyncApi(base, head, baseVersion)
            : compareJsonSchema(base, head);
};
