import {z} from "zod";
import {parse} from "yaml";
import type {BusinessContextSummary} from "../../domain/impact/model/impact-package.js";
import type {BusinessContextPort} from "../../application/review/ports/business-context-port.js";
import type {CodeChange} from "../../domain/review/model/code-change.js";
import type {CommittedFileReader} from "../../application/review/ports/committed-file-reader.js";

const catalogPath = "docs/context/capabilities.yml";
const capabilitySchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    owner: z.string().trim().min(1).max(128),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    authority: z.literal("approved"),
    pathPrefixes: z.array(z.string().trim().min(1).max(512)).min(1).max(64),
}).strict();
const catalogSchema = z.object({
    version: z.literal("v1"),
    capabilities: z.array(capabilitySchema).max(256),
}).strict();

const isSafePrefix = (prefix: string): boolean => !prefix.includes("*")
    && !prefix.includes("\\")
    && !prefix.startsWith("/")
    && !prefix.includes("../");

/**
 * 从 HEAD 中读取经治理的业务能力目录；目录缺失、无效或过期时一律不建立映射。
 */
export class CommittedBusinessContextCatalog implements BusinessContextPort {
    public constructor(
        private readonly fileReader: CommittedFileReader,
        private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    ) {}

    public async resolve(codeChange: CodeChange, signal: AbortSignal): Promise<BusinessContextSummary> {
        const content = await this.fileReader.readHeadFile(catalogPath, signal);
        if (content === undefined) {
            return {status: "unavailable", associations: []};
        }
        const catalog = catalogSchema.safeParse(parse(content));
        if (!catalog.success) {
            return {status: "unavailable", associations: []};
        }
        const capabilities = catalog.data.capabilities.filter((capability) => capability.expiresAt >= this.today()
            && capability.pathPrefixes.every(isSafePrefix));
        if (capabilities.length !== catalog.data.capabilities.length) {
            return {status: "unavailable", associations: []};
        }
        const associations = codeChange.chunks.flatMap((chunk) => capabilities
            .filter((capability) => capability.pathPrefixes.some((prefix) => chunk.path.startsWith(prefix)))
            .map((capability) => ({
                changeAnchorId: chunk.id,
                capability: {id: capability.id, owner: capability.owner},
            })));
        return {status: "available", associations};
    }
}
