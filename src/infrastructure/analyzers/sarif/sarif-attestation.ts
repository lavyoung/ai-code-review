import {createHash, createPrivateKey, createPublicKey, sign, verify} from "node:crypto";
import {z} from "zod";

const SARIF_ATTESTATION_VERSION = "v1";

const payloadSchema = z.object({
    schemaVersion: z.literal(SARIF_ATTESTATION_VERSION),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const attestationSchema = z.object({
    payload: payloadSchema,
    signature: z.string().regex(/^ed25519-v1=[A-Za-z0-9_-]{86}$/),
}).strict();

export type SarifAttestation = z.infer<typeof attestationSchema>;

const payloadBytes = (payload: z.infer<typeof payloadSchema>): Buffer =>
    Buffer.from(JSON.stringify(payload), "utf8");

const decodeBase64Key = (encodedKey: string): Buffer => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey) || encodedKey.length % 4 !== 0) {
        throw new Error("SARIF signing key encoding was invalid.");
    }

    return Buffer.from(encodedKey, "base64");
};

const createEd25519PrivateKey = (encodedKey: string) => {
    const key = createPrivateKey({
        key: decodeBase64Key(encodedKey),
        format: "der",
        type: "pkcs8",
    });
    if (key.asymmetricKeyType !== "ed25519") {
        throw new Error("SARIF signing key must be an Ed25519 private key.");
    }

    return key;
};

const createEd25519PublicKey = (encodedKey: string) => {
    const key = createPublicKey({
        key: decodeBase64Key(encodedKey),
        format: "der",
        type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") {
        throw new Error("SARIF verification key must be an Ed25519 public key.");
    }

    return key;
};

const reportSha256 = (reportContent: string): string =>
    createHash("sha256").update(reportContent, "utf8").digest("hex");

/** 为受控 Java 分析任务的 SARIF 内容创建与提交绑定的完整性证明。 */
export const createSarifAttestation = (
    reportContent: string,
    sourceRevision: string,
    signingPrivateKey: string,
): SarifAttestation => {
    const payload = payloadSchema.parse({
        schemaVersion: SARIF_ATTESTATION_VERSION,
        sourceRevision: sourceRevision.toLowerCase(),
        reportSha256: reportSha256(reportContent),
    });

    return {
        payload,
        signature: `ed25519-v1=${sign(null, payloadBytes(payload), createEd25519PrivateKey(signingPrivateKey))
            .toString("base64url")}`,
    };
};

/**
 * 验证 SARIF 原始字节、签名和当前提交是否全部匹配。
 *
 * 仅证明报告来自持有私钥的受控步骤；调用方仍须保证该步骤未执行不可信 PR 代码。
 */
export const verifySarifAttestation = (
    reportContent: string,
    attestationContent: string,
    currentRevision: string,
    verificationPublicKey: string,
): void => {
    const attestation = attestationSchema.parse(JSON.parse(attestationContent));
    const signature = Buffer.from(attestation.signature.slice("ed25519-v1=".length), "base64url");
    if (!verify(null, payloadBytes(attestation.payload), createEd25519PublicKey(verificationPublicKey), signature)) {
        throw new Error("SARIF attestation signature was invalid.");
    }
    if (attestation.payload.sourceRevision !== currentRevision.toLowerCase()) {
        throw new Error("SARIF attestation revision did not match the committed review revision.");
    }
    if (attestation.payload.reportSha256 !== reportSha256(reportContent)) {
        throw new Error("SARIF attestation did not match the report content.");
    }
};
