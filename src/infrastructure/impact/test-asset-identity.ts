import {createHash} from "node:crypto";

/** 对测试路径使用稳定不透明标识，禁止把路径发送给远程模型。 */
export const createOpaqueTestAssetId = (path: string): string =>
    `test-asset:${createHash("sha256").update(path).digest("hex").slice(0, 16)}`;
