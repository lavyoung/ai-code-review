import type {ReviewConfiguration} from "../application/configuration/review-configuration.js";
import {DeepSeekReviewAdapter} from "../infrastructure/ai/deepseek/deepseek-review-adapter.js";
import {TypeScriptReviewAnalyzer} from "../infrastructure/analyzers/typescript/typescript-review-analyzer.js";
import {
    TypeScriptAstReviewAnalyzer
} from "../infrastructure/analyzers/typescript-ast/typescript-ast-review-analyzer.js";
import {JavaAstReviewAnalyzer} from "../infrastructure/analyzers/java-ast/java-ast-review-analyzer.js";
import {SandboxedTestResultAnalyzer,} from "../infrastructure/analyzers/sandbox-test/sandbox-test-result-analyzer.js";
import {createCommittedRevisionProvider} from "../infrastructure/scm/git/committed-revision-provider.js";
import {SarifReviewAnalyzer} from "../infrastructure/analyzers/sarif/sarif-review-analyzer.js";
import {SecretScanReviewAnalyzer} from "../infrastructure/analyzers/secret-scan/secret-scan-review-analyzer.js";
import {StaticReviewAnalyzerRegistry} from "../application/review/orchestration/static-review-analyzer-registry.js";
import {
    deterministicAnalyzerFindingVerifier
} from "../application/review/verification/deterministic-analyzer-finding-verifier.js";
import {resolveCliConfiguration} from "../infrastructure/configuration/resolve-cli-configuration.js";
import {LocalGitDiffProvider} from "../infrastructure/scm/git/local-git-diff-provider.js";
import {WeComNotifier} from "../infrastructure/notification/wecom/wecom-notifier.js";
import type {ReviewQualityStore} from "../application/review/ports/review-run-record-port.js";
import {LocalJsonlReviewRunRecorder} from "../infrastructure/recording/local-jsonl-review-run-recorder.js";
import {HttpReviewQualityStore} from "../infrastructure/recording/http-review-quality-store.js";
import {CompositeReviewQualityStore} from "../infrastructure/recording/composite-review-quality-store.js";
import {
    LocalJsonlFindingSuppressionReader
} from "../infrastructure/recording/local-jsonl-finding-suppression-reader.js";
import {
    StaticReviewTriggerAdapterRegistry,
} from "../application/review/orchestration/static-review-trigger-adapter-registry.js";
import {LocalManualReviewTriggerAdapter} from "../infrastructure/scm/git/local-manual-review-trigger-adapter.js";
import {
    GitHubPullRequestReviewTriggerAdapter,
} from "../infrastructure/scm/github/github-pull-request-review-trigger-adapter.js";
import {
    CodeUpMergeRequestReviewTriggerAdapter,
} from "../infrastructure/scm/codeup/codeup-merge-request-review-trigger-adapter.js";

/** 在唯一的装配边界创建评审用例所需的具体适配器。 */
export const createReviewDependencies = (
    configuration: ReviewConfiguration,
    workingDirectory: string,
) => {
    const deepSeekAnalyzer = configuration.analyzers.deepseek.enabled
        ? new DeepSeekReviewAdapter(configuration.ai)
        : undefined;
    const typeScriptAnalyzer = new TypeScriptReviewAnalyzer(workingDirectory);
    const typeScriptAstAnalyzer = configuration.analyzers.typescriptAst.enabled
        ? new TypeScriptAstReviewAnalyzer()
        : undefined;
    const javaAstAnalyzer = configuration.analyzers.javaAst.enabled
        ? new JavaAstReviewAnalyzer()
        : undefined;
    const sandboxTestAnalyzer = configuration.analyzers.sandboxTests.enabled
    && configuration.analyzers.sandboxTests.reportPath !== undefined
    && configuration.analyzers.sandboxTests.signingSecret !== undefined
        ? new SandboxedTestResultAnalyzer({
            reportPath: configuration.analyzers.sandboxTests.reportPath,
            signingSecret: configuration.analyzers.sandboxTests.signingSecret,
        }, createCommittedRevisionProvider(workingDirectory))
        : undefined;
    const sarifAnalyzer = configuration.analyzers.sarif.enabled && configuration.analyzers.sarif.reportPath !== undefined
        ? new SarifReviewAnalyzer(
            workingDirectory,
            configuration.analyzers.sarif.reportPath,
            configuration.analyzers.sarif.attestationPath !== undefined
            && configuration.analyzers.sarif.verificationPublicKey !== undefined
                ? {
                    attestationPath: configuration.analyzers.sarif.attestationPath,
                    verificationPublicKey: configuration.analyzers.sarif.verificationPublicKey,
                    revisionProvider: createCommittedRevisionProvider(workingDirectory),
                }
                : undefined,
        )
        : undefined;
    if (configuration.analyzers.sarif.enabled && sarifAnalyzer === undefined) {
        throw new Error("SARIF report path must be configured when the SARIF analyzer is enabled.");
    }
    if (configuration.analyzers.sandboxTests.enabled && sandboxTestAnalyzer === undefined) {
        throw new Error("Sandbox test report and signing secret must be configured when sandbox test analysis is enabled.");
    }
    const secretScanAnalyzer = configuration.analyzers.secretScan.enabled
        ? new SecretScanReviewAnalyzer()
        : undefined;
    const analyzers = [...(deepSeekAnalyzer === undefined ? [] : [deepSeekAnalyzer]), ...(configuration.analyzers.typescript.enabled ? [typeScriptAnalyzer] : []), ...(typeScriptAstAnalyzer === undefined ? [] : [typeScriptAstAnalyzer]), ...(javaAstAnalyzer === undefined ? [] : [javaAstAnalyzer]), ...(sandboxTestAnalyzer === undefined ? [] : [sandboxTestAnalyzer]), ...(sarifAnalyzer === undefined ? [] : [sarifAnalyzer]), ...(secretScanAnalyzer === undefined ? [] : [secretScanAnalyzer])];
    if (analyzers.length === 0) {
        throw new Error("At least one review analyzer must be enabled.");
    }
    const analyzerPlans = [...(deepSeekAnalyzer === undefined ? [] : [{
        analyzerId: deepSeekAnalyzer.identity.id,
        required: true,
        timeoutMs: configuration.ai.timeoutMs,
        retryCount: 2,
        failureMode: "fail" as const,
    }]), ...(configuration.analyzers.typescript.enabled
        ? [{
            analyzerId: typeScriptAnalyzer.identity.id,
            required: true,
            timeoutMs: configuration.analyzers.typescript.timeoutMs,
            retryCount: 0,
            failureMode: "fail" as const,
        }]
        : [])];
    if (sarifAnalyzer !== undefined) {
        analyzerPlans.push({ analyzerId: sarifAnalyzer.identity.id, required: true, timeoutMs: 60_000, retryCount: 0, failureMode: "fail" });
    }
    if (typeScriptAstAnalyzer !== undefined) {
        analyzerPlans.push({
            analyzerId: typeScriptAstAnalyzer.identity.id,
            required: true,
            timeoutMs: 10_000,
            retryCount: 0,
            failureMode: "fail",
        });
    }
    if (javaAstAnalyzer !== undefined) {
        analyzerPlans.push({
            analyzerId: javaAstAnalyzer.identity.id,
            required: true,
            timeoutMs: 10_000,
            retryCount: 0,
            failureMode: "fail",
        });
    }
    if (sandboxTestAnalyzer !== undefined) {
        analyzerPlans.push({
            analyzerId: sandboxTestAnalyzer.identity.id,
            required: true,
            timeoutMs: 10_000,
            retryCount: 0,
            failureMode: "fail",
        });
    }
    if (secretScanAnalyzer !== undefined) {
        analyzerPlans.push({ analyzerId: secretScanAnalyzer.identity.id, required: true, timeoutMs: 5_000, retryCount: 0, failureMode: "fail" });
    }

    return {
        diffProvider: new LocalGitDiffProvider(workingDirectory),
        reviewAnalyzerRegistry: new StaticReviewAnalyzerRegistry(analyzers),
        analyzerPlans,
        analyzerBudget: {
            totalTimeoutMs: configuration.execution.totalTimeoutMs,
            maxConcurrency: configuration.execution.maxAnalyzerConcurrency,
            maxAiRequestCount: configuration.execution.maxAiRequestCount,
            maxModelInputChars: configuration.execution.maxModelInputChars,
        },
        findingVerifiers: [deterministicAnalyzerFindingVerifier],
        ...(configuration.recording.localPath === undefined
            ? {}
            : {findingSuppressionPort: new LocalJsonlFindingSuppressionReader(configuration.recording.localPath)}),
    };
};

/** 创建已配置的本地和/或组织受控脱敏质量存储。 */
export const createReviewQualityStore = (
    configuration: ReviewConfiguration,
): ReviewQualityStore | undefined => {
    const stores: ReviewQualityStore[] = [];
    if (configuration.recording.localPath !== undefined) {
        stores.push(new LocalJsonlReviewRunRecorder(configuration.recording.localPath));
    }

    const qualityStore = configuration.recording.qualityStore;
    if (qualityStore.enabled) {
        if (qualityStore.endpointUrl === undefined || qualityStore.signingSecret === undefined) {
            throw new Error("Quality store configuration was incomplete.");
        }
        stores.push(new HttpReviewQualityStore({
            endpointUrl: qualityStore.endpointUrl,
            signingSecret: qualityStore.signingSecret,
        }));
    }

    if (stores.length === 0) {
        return undefined;
    }

    return stores.length === 1 ? stores[0] : new CompositeReviewQualityStore(stores);
};

/** 解析 CLI 的多来源配置。 */
export const resolveCliReviewConfiguration = resolveCliConfiguration;

/** 在唯一装配边界注册当前受支持的触发平台和事件。 */
export const createReviewTriggerAdapterRegistry = (
    configuration: ReviewConfiguration,
    environment: NodeJS.ProcessEnv = process.env,
) => new StaticReviewTriggerAdapterRegistry([
    new LocalManualReviewTriggerAdapter(),
    new GitHubPullRequestReviewTriggerAdapter({
        environment,
        commentEnabled: configuration.comments.github.enabled,
        commentFailOnError: configuration.comments.github.failOnError,
        ...(configuration.comments.github.accessToken === undefined
            ? {}
            : {accessToken: configuration.comments.github.accessToken}),
        ...(environment.GITHUB_API_URL === undefined ? {} : {apiBaseUrl: environment.GITHUB_API_URL}),
    }),
    new CodeUpMergeRequestReviewTriggerAdapter({
        environment,
        commentEnabled: configuration.comments.codeup.enabled,
        commentFailOnError: configuration.comments.codeup.failOnError,
        ...(configuration.comments.codeup.accessToken === undefined
            ? {}
            : {accessToken: configuration.comments.codeup.accessToken}),
    }),
]);

/** 创建企业微信通知适配器。 */
export const createWeComNotifier = (webhookUrl: string) => new WeComNotifier(webhookUrl);
