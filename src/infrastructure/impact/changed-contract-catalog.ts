import {createHash} from "node:crypto";
import type {CodeChange, RawCodeChange} from "../../domain/review/model/code-change.js";
import type {StaticImpactRelation} from "../../domain/impact/model/impact-package.js";
import {findAddedLineEvidence} from "../../domain/review/policy/find-added-line-evidence.js";
import {isSensitiveFile} from "../../domain/review/policy/sensitive-content-policy.js";
import type {ContractCatalogPort, ContractCatalogResult} from "../../application/review/ports/contract-catalog-port.js";
import type {CommittedContractSourcePort} from "../../application/review/ports/committed-contract-source-port.js";
import {compareCommittedContracts, type ContractKind} from "./contract-compatibility-rules.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const openApiPath = /(?:^|\/)(?:openapi|open-api)(?:\.[\w-]+)?\.(?:json|ya?ml)$/iu;
const asyncApiPath = /(?:^|\/)(?:asyncapi|async-api)(?:\.[\w-]+)?\.(?:json|ya?ml)$/iu;
const contractSchemaPath = /(?:^|\/)docs\/context\/contracts\/.+\.(?:json|ya?ml)$/iu;

const MAX_BREAKING_RELATIONS = 32;

const getContractKind = (path: string): ContractKind | undefined =>
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
 * 它只使用本地版本化规则集判断明确的结构兼容性，不推断消费者或运行时流量。
 */
export class ChangedContractCatalog implements ContractCatalogPort {
    public constructor(private readonly contractSource: CommittedContractSourcePort) {}

    public async analyze(
        rawCodeChange: RawCodeChange,
        codeChange: CodeChange,
        signal: AbortSignal,
    ): Promise<ContractCatalogResult> {
        if (signal.aborted) {
            throw signal.reason;
        }
        const relations: StaticImpactRelation[] = [];
        const limitations = new Set<ContractCatalogResult["limitations"][number]>();
        const contractChanges = rawCodeChange.fileChanges.filter((fileChange) =>
            !isSensitiveFile(fileChange.file)
            && (getContractKind(fileChange.file.path) !== undefined
                || getContractKind(fileChange.file.previousPath ?? fileChange.file.path) !== undefined));
        const paths = [...new Set(contractChanges.flatMap((fileChange) => [
            fileChange.file.path,
            fileChange.file.previousPath ?? fileChange.file.path,
        ].filter((path) => getContractKind(path) !== undefined)))];
        const snapshots = rawCodeChange.revisionRange === undefined || paths.length === 0
            ? undefined
            : await Promise.all([
                this.contractSource.read(rawCodeChange.revisionRange, "base", paths, signal),
                this.contractSource.read(rawCodeChange.revisionRange, "head", paths, signal),
            ]);
        if (contractChanges.length > 0 && (snapshots === undefined
            || snapshots[0].status !== "available"
            || snapshots[1].status !== "available")) {
            limitations.add("contract-diff-unavailable");
        }
        const baseDocuments = new Map(snapshots?.[0].documents.map((document) => [document.path, document.content]));
        const headDocuments = new Map(snapshots?.[1].documents.map((document) => [document.path, document.content]));
        let breakingRelationCount = 0;
        for (const fileChange of contractChanges) {
            if (isSensitiveFile(fileChange.file)) {
                continue;
            }
            const basePath = fileChange.file.previousPath ?? fileChange.file.path;
            const baseKind = getContractKind(basePath);
            const headKind = getContractKind(fileChange.file.path);
            const contractKind = headKind ?? baseKind;
            const addedLine = contractKind === undefined ? undefined : firstAddedLine(fileChange.diff);
            const located = addedLine === undefined
                ? codeChange.chunks.find((chunk) => chunk.path === fileChange.file.path || chunk.path === basePath)
                : findAddedLineEvidence(codeChange, fileChange.file.path, addedLine)?.chunk;
            const sourceLine = addedLine ?? located?.newRange?.startLine ?? located?.oldRange?.startLine;
            if (contractKind === undefined || located === undefined || sourceLine === undefined) {
                continue;
            }
            relations.push({
                id: `contract:${createHash("sha256").update(`${located.id}:${contractKind}`).digest("hex").slice(0, 16)}`,
                changeAnchorId: located.id,
                sourcePath: located.path,
                sourceLine,
                target: contractKind,
                kind: "contract-definition",
                completeness: "partial",
            });
            if (snapshots === undefined || snapshots[0].status !== "available" || snapshots[1].status !== "available"
                || baseKind !== undefined && headKind !== undefined && baseKind !== headKind) {
                limitations.add("contract-diff-unavailable");
                continue;
            }
            const result = compareCommittedContracts(
                contractKind,
                baseKind === contractKind ? baseDocuments.get(basePath) : undefined,
                headKind === contractKind ? headDocuments.get(fileChange.file.path) : undefined,
            );
            if (!result.complete) {
                limitations.add("contract-diff-unavailable");
            }
            for (const change of result.changes) {
                if (breakingRelationCount >= MAX_BREAKING_RELATIONS) {
                    limitations.add("contract-diff-truncated");
                    break;
                }
                const {subject: _subject, ...contractChange} = change;
                const target = `${contractKind}:${contractChange.rule}`;
                relations.push({
                    id: `contract:${createHash("sha256")
                        .update(`${located.id}:${target}:${breakingRelationCount}`)
                        .digest("hex").slice(0, 16)}`,
                    changeAnchorId: located.id,
                    sourcePath: located.path,
                    sourceLine,
                    target,
                    kind: "contract-breaking-change",
                    completeness: "complete",
                    contractChange,
                });
                breakingRelationCount += 1;
            }
        }
        return {relations, limitations: [...limitations]};
    }
}
