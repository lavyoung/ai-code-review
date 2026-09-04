import {z} from "zod";
import {parse} from "yaml";
import type {
    ExternalConsumerContextSummary,
    StaticImpactRelation,
} from "../../domain/impact/model/impact-package.js";
import type {ExternalConsumerCatalogPort} from "../../application/review/ports/external-consumer-catalog-port.js";
import type {CommittedFileReader} from "../../application/review/ports/committed-file-reader.js";

const catalogPath = "docs/context/consumers.yml";
const consumerSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    owner: z.string().trim().min(1).max(128),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    authority: z.literal("approved"),
    status: z.literal("active"),
    contractPaths: z.array(z.string().trim().min(1).max(512)).min(1).max(32),
}).strict();
const catalogSchema = z.object({
    version: z.literal("v1"),
    consumers: z.array(consumerSchema).max(64),
}).strict();

const isSafePath = (path: string): boolean => !path.includes("*")
    && !path.includes("\\")
    && !path.startsWith("/")
    && !path.includes("../");

/**
 * 从 HEAD 读取已知外部消费者的受控快照目录。
 *
 * 任何无效、过期或不存在的契约引用都会使整个目录不可用，避免部分过期映射造成误导。
 */
export class CommittedExternalConsumerCatalog implements ExternalConsumerCatalogPort {
    public constructor(
        private readonly fileReader: CommittedFileReader,
        private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    ) {}

    public async resolve(
        contractRelations: readonly StaticImpactRelation[],
        signal: AbortSignal,
    ): Promise<ExternalConsumerContextSummary> {
        const contracts = contractRelations.filter((relation) => relation.kind === "contract-definition");
        if (contracts.length === 0) {
            return {status: "unavailable", associations: []};
        }
        const content = await this.fileReader.readHeadFile(catalogPath, signal);
        if (content === undefined) {
            return {status: "unavailable", associations: []};
        }
        const catalog = catalogSchema.safeParse(parse(content));
        if (!catalog.success) {
            return {status: "unavailable", associations: []};
        }
        const contractPaths = [...new Set(catalog.data.consumers.flatMap((consumer) => consumer.contractPaths))];
        if (contractPaths.some((path) => !isSafePath(path)) || catalog.data.consumers.some((consumer) =>
            consumer.expiresAt < this.today())) {
            return {status: "unavailable", associations: []};
        }
        const existingContracts = await Promise.all(contractPaths.map(async (path) =>
            (await this.fileReader.readHeadFile(path, signal)) !== undefined));
        if (existingContracts.some((exists) => !exists)) {
            return {status: "unavailable", associations: []};
        }
        return {
            status: "available",
            associations: contracts.flatMap((relation) => catalog.data.consumers
                .filter((consumer) => consumer.contractPaths.includes(relation.sourcePath))
                .map((consumer) => ({
                    changeAnchorId: relation.changeAnchorId,
                    consumer: {id: consumer.id, owner: consumer.owner, sourceRevision: consumer.sourceRevision},
                }))),
        };
    }
}
