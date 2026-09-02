import {z} from "zod";
import {SEVERITIES} from "../../../domain/review/model/severity.js";

/** 所有 AI 提供方共用的结构化输出契约版本。 */
export const STRUCTURED_REVIEW_CONTRACT_VERSION = "v1";

/**
 * 模型输出的候选发现项 Schema。
 *
 * `chunkId` 与 `evidence` 在提示词中是必填要求；此处保持可选，以便领域层把
 * 不满足锚定要求的单个候选项安全地抑制，而不是丢弃同一响应中的其他有效发现。
 */
export const structuredReviewFindingSchema = z.object({
    severity: z.enum(SEVERITIES),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    file: z.string().trim().min(1).optional(),
    line: z.number().int().positive().optional(),
    category: z.string().trim().min(1).optional(),
    suggestion: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    chunkId: z.string().trim().min(1).optional(),
    evidence: z.string().trim().min(1).max(500).optional(),
});

/** 所有 AI 适配器都必须解析为该平台无关的候选输出。 */
export const structuredReviewAnalysisSchema = z.object({
    summary: z.string().trim().min(1),
    findings: z.array(structuredReviewFindingSchema).max(20),
});

export type StructuredReviewAnalysis = z.infer<typeof structuredReviewAnalysisSchema>;

/** 用于支持 JSON Schema 的供应商请求，且与运行时解析使用同一个 Zod 源。 */
export const STRUCTURED_REVIEW_OUTPUT_JSON_SCHEMA = z.toJSONSchema(structuredReviewAnalysisSchema);

/** 提示词中的示例只说明字段用途；约束仍以同模块的运行时 Schema 为准。 */
export const STRUCTURED_REVIEW_OUTPUT_EXAMPLE = {
    summary: "short summary",
    findings: [{
        severity: "high",
        title: "short title",
        description: "why this is a problem",
        file: "safe/path.ts",
        line: 42,
        chunkId: "stable-chunk-id",
        evidence: "+exact changed line",
        category: "correctness",
        suggestion: "specific fix",
        confidence: 0.9,
    }],
};

/** 可由任意 AI 适配器复用的版本化结构化评审契约。 */
export const STRUCTURED_REVIEW_CONTRACT = {
    version: STRUCTURED_REVIEW_CONTRACT_VERSION,
    outputSchema: STRUCTURED_REVIEW_OUTPUT_JSON_SCHEMA,
    outputExample: STRUCTURED_REVIEW_OUTPUT_EXAMPLE,
    parse: (value: unknown): StructuredReviewAnalysis => structuredReviewAnalysisSchema.parse(value),
} as const;
