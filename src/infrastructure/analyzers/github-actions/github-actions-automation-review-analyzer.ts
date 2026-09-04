import type {RawCodeChange} from "../../../domain/review/model/code-change.js";
import type {ReviewAnalysis} from "../../../domain/review/model/review-finding.js";
import type {ReviewCandidate} from "../../../domain/review/model/review-candidate.js";
import {classifyRepositoryFile} from "../../../domain/automation/policy/classify-repository-file.js";
import {findAddedLineEvidenceContaining} from "../../../domain/review/policy/find-added-line-evidence.js";
import type {CommittedFileReader} from "../../../application/review/ports/committed-file-reader.js";
import {resolveAutomationDefinitionGraph} from "../../../application/review/orchestration/resolve-automation-definition-graph.js";
import type {AutomationParserRegistry} from "../../../application/review/ports/automation-parser-adapter.js";
import type {
    AnalysisRequest,
    AnalyzerIdentity,
    ReviewAnalyzer,
} from "../../../application/review/ports/review-analyzer-port.js";

const isTrustedLocalRequest = (request: AnalysisRequest): request is AnalysisRequest & {
    rawCodeChange: RawCodeChange;
} => "rawCodeChange" in request;

const isChangedActiveWorkflow = (path: string, status: string): boolean =>
    status !== "deleted" && classifyRepositoryFile(path).reachability === "active";

/**
 * 将 GitHub Actions 工作流转换为观察模式的通用安全建议。
 *
 * 规则只引用已提交 HEAD 的解析结果，且每项必须锚定到本次新增的配置行；它们不声明可验证缺陷，
 * 不参与质量门禁。
 */
export class GitHubActionsAutomationReviewAnalyzer implements ReviewAnalyzer {
    public readonly identity: AnalyzerIdentity = {kind: "sast", id: "github-actions-automation"};

    public readonly capabilities = {
        inputAccess: "trusted-raw-local" as const,
        supportsChangedOnly: true,
        supportsRepositoryScan: false,
    };

    public constructor(
        private readonly committedFileReader: CommittedFileReader,
        private readonly automationParserRegistry: AutomationParserRegistry,
    ) {}

    public async analyze(request: AnalysisRequest): Promise<ReviewAnalysis> {
        if (!isTrustedLocalRequest(request)) {
            throw new Error("Automation analysis requires trusted raw local input.");
        }

        const findings: ReviewCandidate[] = [];
        let parsedCount = 0;
        let unavailableCount = 0;
        let reachableContextCount = 0;
        let cycleCount = 0;
        let unavailableReferenceCount = 0;
        for (const fileChange of request.rawCodeChange.fileChanges) {
            const {path, status} = fileChange.file;
            if (!isChangedActiveWorkflow(path, status)) {
                continue;
            }
            const content = await this.committedFileReader.readHeadFile(path, request.signal);
            if (content === undefined) {
                unavailableCount += 1;
                continue;
            }
            const resolved = await resolveAutomationDefinitionGraph({
                platformId: "github-actions",
                rootPath: path,
                rootContent: content,
                signal: request.signal,
            }, {
                committedFileReader: this.committedFileReader,
                automationParserRegistry: this.automationParserRegistry,
            });
            if (resolved.graph === undefined) {
                unavailableCount += 1;
                continue;
            }
            parsedCount += 1;
            reachableContextCount += resolved.graph.reachableDefinitions.length - 1;
            cycleCount += resolved.graph.cycleCount;
            unavailableReferenceCount += resolved.graph.unavailableReferenceCount;
            findings.push(...this.findMutableReferenceCandidates(resolved.graph.root.externalReferences, path, request));
            findings.push(...this.findUntrustedWriteCandidates(resolved.graph.root.jobs, resolved.graph.root.triggers, path, request));
        }

        return {
            summary: `GitHub Actions automation analysis parsed ${parsedCount} workflow(s), loaded ${reachableContextCount} reachable reusable workflow(s), detected ${cycleCount} cycle(s), left ${unavailableReferenceCount} local reference(s) unresolved, produced ${findings.length} advisory candidate(s), and skipped ${unavailableCount} workflow(s).`,
            findings,
        };
    }

    private findMutableReferenceCandidates(
        references: readonly {reference: string; immutability: "pinned" | "mutable" | "unknown"}[],
        path: string,
        request: AnalysisRequest,
    ): ReviewCandidate[] {
        return references.flatMap((reference) => {
            if (reference.immutability !== "mutable") {
                return [];
            }
            const located = findAddedLineEvidenceContaining(request.codeChange, path, reference.reference);
            if (located === undefined) {
                return [];
            }
            return [{
                severity: "medium",
                title: "Mutable automation dependency reference",
                description: "The changed workflow references an external automation dependency by a mutable tag or version.",
                suggestion: "Pin the dependency to an immutable commit SHA or content digest after validating the intended release.",
                category: "automation-supply-chain",
                assertionType: "security-risk",
                file: path,
                line: located.line,
                chunkId: located.chunk.id,
                evidence: located.evidence,
            }];
        });
    }

    private findUntrustedWriteCandidates(
        jobs: readonly {trustBoundary: "trusted" | "untrusted" | "mixed" | "unknown"; permissions: readonly {access: string}[]}[],
        triggers: readonly {name: string}[],
        path: string,
        request: AnalysisRequest,
    ): ReviewCandidate[] {
        if (!jobs.some((job) => (job.trustBoundary === "untrusted" || job.trustBoundary === "mixed")
            && job.permissions.some((permission) => permission.access === "write"))) {
            return [];
        }
        const triggerName = triggers.find((trigger) => trigger.name === "pull_request" || trigger.name === "pull_request_target"
            || trigger.name === "issue_comment" || trigger.name === "discussion_comment")?.name;
        const located = triggerName === undefined
            ? findAddedLineEvidenceContaining(request.codeChange, path, "write")
            : findAddedLineEvidenceContaining(request.codeChange, path, triggerName)
                ?? findAddedLineEvidenceContaining(request.codeChange, path, "write");
        if (located === undefined) {
            return [];
        }
        return [{
            severity: "high",
            title: "Untrusted automation trigger has write permission",
            description: "The changed workflow combines an untrusted trigger with a job that declares write access.",
            suggestion: "Separate untrusted processing from write-capable jobs and use the minimum required token permissions.",
            category: "automation-trust-boundary",
            assertionType: "security-risk",
            file: path,
            line: located.line,
            chunkId: located.chunk.id,
            evidence: located.evidence,
        }];
    }
}
