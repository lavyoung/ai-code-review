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
            return replace(arguments_[0], arguments_[1]);
        });
    }

    return { content: redactedContent, redactedValueCount };
};

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
