import { describe, expect, it, vi } from "vitest";
import { DeepSeekReviewAdapter } from "../src/infrastructure/deepseek/deepseek-review-adapter.js";

const configuration = {
    provider: "deepseek" as const,
    model: "deepseek-v4-flash",
    timeoutMs: 30_000,
    apiKey: "test-api-key",
};

const codeChange = {
    diff: "diff --git a/src/example.ts b/src/example.ts\n",
    files: [{ path: "src/example.ts", status: "modified" as const }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("DeepSeekReviewAdapter", () => {
    it("requests JSON output and parses a structured review result", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify({
                        summary: "One issue found.",
                        findings: [{
                            severity: "high",
                            title: "Missing validation",
                            description: "The input is used without validation.",
                            file: "src/example.ts",
                            line: 10,
                            category: "correctness",
                            suggestion: "Validate the input first.",
                            confidence: 0.9,
                        }],
                    }),
                },
            }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).resolves.toEqual({
            summary: "One issue found.",
            findings: [{
                severity: "high",
                title: "Missing validation",
                description: "The input is used without validation.",
                file: "src/example.ts",
                line: 10,
                category: "correctness",
                suggestion: "Validate the input first.",
                confidence: 0.9,
            }],
        });

        expect(fetchImplementation).toHaveBeenCalledWith(
            "https://api.deepseek.com/chat/completions",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-api-key",
                }),
            }),
        );
        expect(JSON.parse(fetchImplementation.mock.calls[0][1].body)).toMatchObject({
            model: "deepseek-v4-flash",
            response_format: { type: "json_object" },
            max_tokens: 4_096,
            stream: false,
        });
    });

    it("rejects an incomplete response", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: "{}" } }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).rejects.toMatchObject({
            failureType: "incomplete-response",
        });
    });

    it("accepts a JSON result wrapped in a Markdown code fence", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                finish_reason: "stop",
                message: { content: "```json\n{\"summary\":\"No issues.\",\"findings\":[]}\n```" },
            }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).resolves.toEqual({
            summary: "No issues.",
            findings: [],
        });
    });

    it("accepts a JSON result wrapped in an unlabelled code fence", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                finish_reason: "stop",
                message: { content: "```\n{\"summary\":\"No issues.\",\"findings\":[]}\n```" },
            }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).resolves.toEqual({
            summary: "No issues.",
            findings: [],
        });
    });

    it("classifies an empty JSON-mode response as incomplete", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "   " } }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).rejects.toMatchObject({
            failureType: "incomplete-response",
        });
    });

    it("reports only safe metadata for malformed JSON output", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).rejects.toMatchObject({
            failureType: "invalid-json",
            message: "DeepSeek review output was not valid JSON (length=8, shape=other, codeFence=false).",
        });
    });

    it("reports safe metadata when the API response body is not JSON", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response("not-json", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
        }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).rejects.toMatchObject({
            failureType: "invalid-json",
            message: "DeepSeek response was not JSON (status=200, contentType=text/plain, contentLength=unknown).",
        });
    });

    it("classifies an API rate limit without exposing provider details", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).rejects.toMatchObject({
            failureType: "rate-limit",
        });
    });

    it("removes sensitive paths from model findings", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify({
                        summary: "One issue found.",
                        findings: [{
                            severity: "high",
                            title: "Sensitive finding",
                            description: "A sensitive file was mentioned.",
                            file: ".env.production",
                            line: 1,
                        }],
                    }),
                },
            }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).resolves.toEqual({
            summary: "One issue found.",
            findings: [{
                severity: "high",
                title: "Sensitive finding",
                description: "A sensitive file was mentioned.",
            }],
        });
    });

    it("redacts sensitive values returned in model findings", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify({
                        summary: "One issue found.",
                        findings: [{
                            severity: "high",
                            title: "Authorization: Bearer exposed-token",
                            description: "token: exposed-token",
                        }],
                    }),
                },
            }],
        }), { status: 200 }));
        const adapter = new DeepSeekReviewAdapter(configuration, fetchImplementation);

        await expect(adapter.review(codeChange)).resolves.toEqual({
            summary: "One issue found.",
            findings: [{
                severity: "high",
                title: "Authorization: Bearer [REDACTED]",
                description: "token: [REDACTED]",
            }],
        });
    });
});
