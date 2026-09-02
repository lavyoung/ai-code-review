import { verifyDeterministicAnalyzerFinding } from "../../../domain/review/policy/verify-deterministic-analyzer-finding.js";
import type { FindingVerifier } from "../ports/finding-verifier-port.js";

/** 将受信任确定性分析器的已锚定发现提升为可参与门禁的 `verified`。 */
export const deterministicAnalyzerFindingVerifier: FindingVerifier = {
    id: "deterministic-analyzer",
    verify: (finding) => verifyDeterministicAnalyzerFinding(finding),
};
