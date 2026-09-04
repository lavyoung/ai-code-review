import {createHash} from "node:crypto";
import type {CodeChange, RawCodeChange} from "../../domain/review/model/code-change.js";
import type {StaticImpactRelation} from "../../domain/impact/model/impact-package.js";
import {findAddedLineEvidence} from "../../domain/review/policy/find-added-line-evidence.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";
import type {ContractCatalogPort, ContractCatalogResult} from "../../application/review/ports/contract-catalog-port.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const openApiPath = /(?:^|\/)(?:openapi|open-api)(?:\.[\w-]+)?\.(?:json|ya?ml)$/iu;
const asyncApiPath = /(?:^|\/)(?:asyncapi|async-api)(?:\.[\w-]+)?\.(?:json|ya?ml)$/iu;
const contractSchemaPath = /(?:^|\/)docs\/context\/contracts\/.+\.(?:json|ya?ml)$/iu;

const getContractKind = (path: string): "openapi" | "asyncapi" | "json-schema" | undefined =>
    openApiPath.test(path) ? "openapi"
        : asyncApiPath.test(path) ? "asyncapi"
            : contractSchemaPath.test(path) ? "json-schema"
                : undefined;

const firstAddedLine = (diff: string): number | undefined => {
    let newLine: number | undefined;
    for (const line of diff.split("\n")) {
        const header = HUNK_HEADER.exec(line);
        if (header !== null) {
            newLine = Number(header[1]);
            continue;
        }
        if (newLine === undefined || line.startsWith("\\ No newline")) {
            continue;
        }
        if (line.startsWith("+") && !line.startsWith("+++")) {
            return newLine;
        }
        if (line.startsWith(" ")) {
            newLine += 1;
        }
    }
    return undefined;
};

/**
 * 从明确约定的位置识别已锚定的版本化契约修改。
 *
 * 它不解析完整规范，也不推断兼容性、消费者或运行时流量。
 */
export class ChangedContractCatalog implements ContractCatalogPort {
    public async analyze(
        rawCodeChange: RawCodeChange,
        codeChange: CodeChange,
        signal: AbortSignal,
    ): Promise<ContractCatalogResult> {
        if (signal.aborted) {
            throw signal.reason;
        }
        const relations: StaticImpactRelation[] = [];
        for (const fileChange of rawCodeChange.fileChanges) {
            if (isSensitiveFile(fileChange.file)) {
                continue;
            }
            const contractKind = getContractKind(fileChange.file.path);
            const addedLine = contractKind === undefined ? undefined : firstAddedLine(fileChange.diff);
            if (contractKind === undefined || addedLine === undefined) {
                continue;
            }
            const located = findAddedLineEvidence(codeChange, fileChange.file.path, addedLine);
            if (located === undefined) {
                continue;
            }
            relations.push({
                id: `contract:${createHash("sha256").update(`${located.chunk.id}:${contractKind}`).digest("hex").slice(0, 16)}`,
                changeAnchorId: located.chunk.id,
                sourcePath: located.chunk.path,
                sourceLine: addedLine,
                target: contractKind,
                kind: "contract-definition",
                completeness: "partial",
            });
        }
        return {relations, limitations: []};
    }
}
