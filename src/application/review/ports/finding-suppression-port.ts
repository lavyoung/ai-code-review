/**
 * 读取当前有效的人工误报抑制键。
 *
 * 端口只交换不可逆发现指纹，不能接收或返回路径、代码、diff、评论正文或密钥。
 */
export interface FindingSuppressionPort {
    getActiveSuppressedFingerprints(now?: Date): Promise<readonly string[]>;
}
