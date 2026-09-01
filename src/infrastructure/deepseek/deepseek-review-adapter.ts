import { z } from "zod";
import type { ReviewConfiguration } from "../../application/config/review-configuration.js";
import { buildStructuredReviewPrompt } from "../../application/build-structured-review-prompt.js";
import type { AiReviewPort } from "../../application/ports/ai-review-port.js";
import { AiReviewFailure } from "../../application/review-execution-error.js";
import type { CodeChange } from "../../domain/review/code-change.js";
import type {
    ReviewAnalysis,
    ReviewFinding,
} from "../../domain/review/review-finding.js";
import { SEVERITIES } from "../../domain/review/severity.js";
import {
    isSensitiveFile,
    redactSensitiveFilePaths,
    redactSensitiveValues,
} from "../../domain/review/sensitive-content-policy.js";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const MAX_OUTPUT_TOKENS = 4_096;

const reviewFindingSchema = z.object({
    severity: z.enum(SEVERITIES),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    file: z.string().trim().min(1).optional(),
    line: z.number().int().positive().optional(),
    category: z.string().trim().min(1).optional(),
    suggestion: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
});

const reviewAnalysisSchema = z.object({
    summary: z.string().trim().min(1),
    findings: z.array(reviewFindingSchema).max(20),
});

const chatCompletionSchema = z.object({
    choices: z.array(z.object({
        finish_reason: z.string(),
        message: z.object({
            content: z.string().nullable(),
        }),
    })).min(1),
});

/** 移除偶发的 Markdown JSON 包装，不记录模型原始输出。 */
const unwrapJsonCodeFence = (content: string): { content: string; wasCodeFenced: boolean } => {
    const trimmed = content.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

    return {
        content: match?.[1] ?? trimmed,
        wasCodeFenced: match !== null,
    };
};

/** 仅输出 JSON 解析所需的安全元数据，不输出模型原文。 */
const describeOutputShape = (content: string): string => {
    if (content.startsWith("{")) {
        return "object";
    }

    if (content.startsWith("[")) {
        return "array";
    }

    return "other";
};

/** 将 API 响应诊断限定为不含正文的协议元数据。 */
const describeResponseMetadata = (response: Response): string => {
    const contentType = response.headers.get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
    const contentLength = response.headers.get("content-length");

    return `status=${response.status}, contentType=${contentType === undefined || contentType === ""
        ? "unknown"
        : contentType}, contentLength=${contentLength ?? "unknown"}`;
};

/** 响应解析日志只保留长度与 Unicode 边界信息，避免输出模型正文。 */
const describeResponseText = (value: string): string => {
    const firstCodePoint = value.codePointAt(0);
    const lastCodePoint = value.codePointAt(value.length - 1);

    return `length=${value.length}, firstCodePoint=${firstCodePoint === undefined
        ? "none"
        : `U+${firstCodePoint.toString(16).toUpperCase()}`}, lastCodePoint=${lastCodePoint === undefined
        ? "none"
        : `U+${lastCodePoint.toString(16).toUpperCase()}`}`;
};

const isTimeoutError = (error: unknown): boolean => error instanceof Error
    && (error.name === "AbortError" || error.name === "TimeoutError");

const toReviewFinding = (
    finding: z.infer<typeof reviewFindingSchema>,
): ReviewFinding => ({
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    ...(finding.file === undefined ? {} : { file: finding.file }),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(finding.category === undefined ? {} : { category: finding.category }),
    ...(finding.suggestion === undefined ? {} : { suggestion: finding.suggestion }),
    ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
});

const removeSensitiveFindingPath = (finding: ReviewFinding): ReviewFinding => {
    if (finding.file === undefined || !isSensitiveFile({
        path: finding.file,
        status: "modified",
    })) {
        return finding;
    }

    const { file: _file, line: _line, ...safeFinding } = finding;
    return safeFinding;
};

const redactFindingText = (value: string): string =>
    redactSensitiveFilePaths(redactSensitiveValues(value).content);

const redactSensitiveFindingValues = (finding: ReviewFinding): ReviewFinding => ({
    ...finding,
    title: redactFindingText(finding.title),
    description: redactFindingText(finding.description),
    ...(finding.category === undefined
        ? {}
        : { category: redactFindingText(finding.category) }),
    ...(finding.suggestion === undefined
        ? {}
        : { suggestion: redactFindingText(finding.suggestion) }),
});

/**
 * DeepSeek Chat Completions 的结构化代码评审适配器。
 */
export class DeepSeekReviewAdapter implements AiReviewPort {
    public readonly provider = "deepseek" as const;

    /**
     * @param configuration 已解析的 DeepSeek 配置；密钥不应输出到日志。
     * @param fetchImplementation 可替换的 HTTP 实现，用于测试。
     */
    public constructor(
        private readonly configuration: ReviewConfiguration["ai"],
        private readonly fetchImplementation: typeof fetch = fetch,
    ) {}

    /**
     * 调用 DeepSeek JSON Output，并验证、清理返回的评审发现项。
     *
     * @throws API Key 缺失、请求失败、响应不完整或结构不合法时抛出异常。
     */
    public async review(codeChange: CodeChange): Promise<ReviewAnalysis> {
        if (this.configuration.apiKey === undefined) {
            throw new AiReviewFailure("authentication", "DeepSeek API key is required.");
        }

        const prompt = buildStructuredReviewPrompt(codeChange, this.configuration.outputLanguage);
        let response: Response;
        try {
            response = await this.fetchImplementation(DEEPSEEK_CHAT_COMPLETIONS_URL, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.configuration.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.configuration.model,
                    thinking: { type: "disabled" },
                    messages: [
                        { role: "system", content: prompt.system },
                        { role: "user", content: prompt.user },
                    ],
                    response_format: { type: "json_object" },
                    max_tokens: MAX_OUTPUT_TOKENS,
                    stream: false,
                }),
                signal: AbortSignal.timeout(this.configuration.timeoutMs),
            });
        } catch (error) {
            const failureType = error instanceof Error
                && (error.name === "AbortError" || error.name === "TimeoutError")
                ? "timeout"
                : "request";
            throw new AiReviewFailure(failureType, "DeepSeek review request failed.", error);
        }
        if (!response.ok) {
            const failureType = response.status === 401 || response.status === 403
                ? "authentication"
                : response.status === 413
                    ? "context-limit"
                    : response.status === 429
                        ? "rate-limit"
                        : "request";
            throw new AiReviewFailure(failureType, "DeepSeek review request failed.");
        }

        let responseText: string;
        try {
            responseText = await response.text();
        } catch (error) {
            throw new AiReviewFailure(
                isTimeoutError(error) ? "timeout" : "request",
                `DeepSeek response body could not be read (${describeResponseMetadata(response)}).`,
            );
        }

        let responseBody: unknown;
        try {
            responseBody = JSON.parse(responseText.replace(/^\uFEFF/, "").trim());
        } catch {
            throw new AiReviewFailure(
                "invalid-json",
                `DeepSeek response was not JSON (${describeResponseMetadata(response)}, ${describeResponseText(responseText)}).`,
            );
        }

        let completion: z.infer<typeof chatCompletionSchema>;
        try {
            completion = chatCompletionSchema.parse(responseBody);
        } catch (error) {
            throw new AiReviewFailure("invalid-schema", "DeepSeek response schema was invalid.", error);
        }
        const choice = completion.choices[0];
        if (choice === undefined || choice.message.content === null) {
            throw new AiReviewFailure("incomplete-response", "DeepSeek review response was incomplete.");
        }
        if (choice.finish_reason === "content_filter") {
            throw new AiReviewFailure("content-filtered", "DeepSeek review response was filtered.");
        }
        if (choice.finish_reason !== "stop") {
            throw new AiReviewFailure("incomplete-response", "DeepSeek review response was incomplete.");
        }

        const normalizedOutput = unwrapJsonCodeFence(choice.message.content);
        const { content } = normalizedOutput;
        if (content.length === 0) {
            throw new AiReviewFailure("incomplete-response", "DeepSeek review response was incomplete.");
        }

        let output: unknown;
        try {
            output = JSON.parse(content);
        } catch {
            throw new AiReviewFailure(
                "invalid-json",
                `DeepSeek review output was not valid JSON (length=${content.length}, shape=${describeOutputShape(content)}, codeFence=${normalizedOutput.wasCodeFenced}).`,
            );
        }

        let analysis: z.infer<typeof reviewAnalysisSchema>;
        try {
            analysis = reviewAnalysisSchema.parse(output);
        } catch (error) {
            throw new AiReviewFailure("invalid-schema", "DeepSeek review output schema was invalid.", error);
        }

        return {
            summary: analysis.summary,
            findings: analysis.findings
                .map(toReviewFinding)
                .map(redactSensitiveFindingValues)
                .map(removeSensitiveFindingPath),
        };
    }
}
