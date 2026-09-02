import type { ChangedFile } from "../model/code-change.js";

const sensitivePathPatterns = [
    /(^|\/)\.env(?:\.[^/]+)?$/i,
    /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i,
    /(^|\/)(?:credentials?|secrets?|tokens?|api[-_]?keys?)\b/i,
    /(^|\/)(?:\.npmrc|\.netrc|\.pypirc)$/i,
    /(^|\/)\.aws\/credentials$/i,
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
];

type RedactionReplacement = (match: string, prefix?: string, value?: string) => string;

const redactAssignmentValue: RedactionReplacement = (_match, prefix = "", value = "") => {
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";

    return `${prefix}${quote}[REDACTED]${quote}`;
};

const redactPatterns: readonly [RegExp, RedactionReplacement][] = [
    [
        /((?:api[_-]?key|access[_-]?token|token|secret|password)\s*(?::|=(?!=))\s*)("[^"]*"|'[^']*'|[^\s,;}\])"']+)/gi,
        redactAssignmentValue,
    ],
    [
        /(authorization\s*:\s*(?:bearer|basic)\s+)[^\s"']+/gi,
        (_match, prefix = "") => `${prefix}[REDACTED]`,
    ],
    [
        /\bsk-[a-z0-9_-]{8,}\b/gi,
        () => "[REDACTED]",
    ],
    [
        /\bgh[pousr]_[a-z0-9_]{36,255}\b/gi,
        () => "[REDACTED]",
    ],
    [
        /\bgithub_pat_[a-z0-9_]{22,255}\b/gi,
        () => "[REDACTED]",
    ],
    [
        /\bAKIA[0-9A-Z]{16}\b/g,
        () => "[REDACTED]",
    ],
    [
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
        () => "[REDACTED]",
    ],
];

/** 仅包含足以触发确定性安全发现的高置信度凭据特征。 */
const highConfidenceSecretPatterns = [
    /\bsk-[a-z0-9_-]{8,}\b/i,
    /\bgh[pousr]_[a-z0-9_]{36,255}\b/i,
    /\bgithub_pat_[a-z0-9_]{22,255}\b/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
] as const;

const isSensitivePath = (path: string): boolean => {
    const normalizedPath = path.replaceAll("\\", "/");

    return sensitivePathPatterns.some((pattern) => pattern.test(normalizedPath));
};

/**
 * 判断文件路径（含重命名前的路径）是否应从评审上下文中排除。
 */
export const isSensitiveFile = (file: ChangedFile): boolean =>
    isSensitivePath(file.path)
    || (file.previousPath !== undefined && isSensitivePath(file.previousPath));

/**
 * 文本脱敏结果及本次替换次数。
 */
export interface RedactedContent {
    content: string;
    redactedValueCount: number;
}

/**
 * 对可进入评审上下文的文本执行值级别脱敏。
 */
export const redactSensitiveValues = (content: string): RedactedContent => {
    let redactedValueCount = 0;
    let redactedContent = content;

    for (const [pattern, replace] of redactPatterns) {
        redactedContent = redactedContent.replace(pattern, (...arguments_) => {
            redactedValueCount += 1;
            return replace(arguments_[0], arguments_[1], arguments_[2]);
        });
    }

    return { content: redactedContent, redactedValueCount };
};

/** 判断文本是否包含高置信度凭据特征，绝不返回匹配到的原文。 */
export const containsHighConfidenceSecret = (content: string): boolean =>
    highConfidenceSecretPatterns.some((pattern) => pattern.test(content));

/**
 * 替换自由文本中出现的敏感文件路径，防止其进入日志、评论或通知正文。
 */
export const redactSensitiveFilePaths = (content: string): string =>
    content.replace(/[a-z0-9_./\\-]+/gi, (token) =>
        (token.includes(".") || token.includes("/") || token.includes("\\"))
        && isSensitivePath(token)
            ? "[REDACTED_FILE]"
            : token,
    );
