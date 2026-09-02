import { createHash } from "node:crypto";
import type { ValidatedFinding } from "../model/review-candidate.js";

const normalize = (value: string | undefined): string => value
    ?.trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    ?? "";

/**
 * 为同一变更中的逻辑相同发现创建稳定标识。
 *
 * 描述、建议与证据文本均可能随模型措辞变化，且不应参与跨运行关联；指纹只包含
 * 已脱敏的变更块标识、位置和规范化分类/标题。
 */
export const createFindingFingerprint = (finding: Omit<ValidatedFinding, "fingerprint">): string =>
    createHash("sha256")
        .update(JSON.stringify({
            chunkId: finding.chunkId,
            line: finding.line ?? null,
            category: normalize(finding.category),
            title: normalize(finding.title),
        }))
        .digest("hex")
        .slice(0, 24);
