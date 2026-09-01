import type { ChangedFile } from "./code-change.js";

const sensitivePathPatterns = [
    /(^|\/)\.env(?:\.[^/]+)?$/i,
    /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i,
    /(^|\/)(?:credentials?|secrets?|tokens?|api[-_]?keys?)\b/i,
    /(^|\/)(?:\.npmrc|\.netrc|\.pypirc)$/i,
    /(^|\/)\.aws\/credentials$/i,
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
];

const redactPatterns: readonly [RegExp, (match: string, prefix?: string) => string][] = [
    [
        /((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
        (_match, prefix = "") => `${prefix}[REDACTED]`,
    ],
    [
        /(authorization\s*:\s*(?:bearer|basic)\s+)[^\s"']+/gi,
        (_match, prefix = "") => `${prefix}[REDACTED]`,
    ],
    [
        /\bsk-[a-z0-9_-]{8,}\b/gi,
        () => "[REDACTED]",
    ],
];

const isSensitivePath = (path: string): boolean => {
    const normalizedPath = path.replaceAll("\\", "/");

    return sensitivePathPatterns.some((pattern) => pattern.test(normalizedPath));
};

export const isSensitiveFile = (file: ChangedFile): boolean =>
    isSensitivePath(file.path)
    || (file.previousPath !== undefined && isSensitivePath(file.previousPath));

export interface RedactedContent {
    content: string;
    redactedValueCount: number;
}

export const redactSensitiveValues = (content: string): RedactedContent => {
    let redactedValueCount = 0;
    let redactedContent = content;

    for (const [pattern, replace] of redactPatterns) {
        redactedContent = redactedContent.replace(pattern, (...arguments_) => {
            redactedValueCount += 1;
            return replace(arguments_[0], arguments_[1]);
        });
    }

    return { content: redactedContent, redactedValueCount };
};
