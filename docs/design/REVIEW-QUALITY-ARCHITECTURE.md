# 可验证 AI 代码评审架构

## 1. 决策摘要

`ai-code-review` 采用**模块化单体（modular monolith）+ 六边形架构（ports and adapters）+ 可验证评审流水线**。

系统不把任意 AI 模型的文本结论直接视为最终评审结论。所有分析器（AI、静态扫描、类型检查、测试、密钥扫描）先产生统一的候选发现项，再经证据和可执行验证，最后由领域策略统一决定评论、通知、质量门禁和退出码。

这项设计的目标是：

- 新增 AI 提供方、静态分析器、验证器或代码托管平台时，不修改核心评审用例和领域策略。
- AI 发现必须可以追溯到本次已提交变更，避免不存在的代码、行号和脱敏文本被误报为缺陷。
- 质量门禁只依据可验证结果和显式策略，不依据模型自报 `confidence`。
- 通过稳定指纹和反馈数据持续度量误报率，驱动规则、提示词和模型选择迭代。

该架构是长期目标；当前仍作为一个 CLI/Action 发布，不拆分为微服务，也不引入运行时插件市场。

## 2. 设计原则

### 2.1 规范化结果，不规范化提供方

DeepSeek、OpenAI、未来本地模型的 HTTP 协议、提示词格式和限流语义属于基础设施差异。领域和应用层只识别统一的评审请求、候选发现项、验证结果与投递结果。

### 2.2 证据先于结论

每个可对外输出的发现项必须至少能对应本次变更中的一个安全 `DiffChunk`。无法建立映射的候选项不进入评论、通知和门禁；它可作为脱敏统计记录，用于分析模型质量。

`confidence` 仅是模型的辅助排序信息，不能作为真实性或门禁依据。

### 2.3 事实与判断分离

- **事实型发现**：密钥泄露、类型错误、测试失败、SAST 告警等，可由确定性工具或可执行验证确认。
- **语义型发现**：逻辑风险、设计缺陷、边界条件、可维护性建议等，通常无法自动证明，应保留为人工决策辅助。

事实型发现可按策略阻断；语义型 AI 发现默认只生成摘要评论和通知。任何发现都必须达到 `verified` 状态才允许触发门禁；项目配置只能调整严重级别和所需验证方法，不能绕过验证将 AI 文本直接作为门禁。

### 2.4 安全是整个流水线的约束

原始已提交内容、可发送给模型的内容和可对外输出的内容必须严格分级。证据持久化使用摘要、范围和哈希，而不是保存完整原始 diff。

### 2.5 扩展通过注册，不通过核心分支判断

应用层不得出现 `if (provider === "deepseek")`、`if (platform === "github")` 等逻辑。具体实现由 bootstrap 中的注册表装配，并以能力声明驱动调用。

## 3. 逻辑架构

```text
接口层（CLI / GitHub Action / 未来 Webhook）
                    |
                    v
应用层：ReviewChangeSetUseCase
  解析范围 -> 获取变更 -> 安全过滤 -> 生成上下文 -> 调度分析器
                    |
                    v
领域层：评审质量决策
  Candidate -> Evidence -> Verification -> Finding -> PolicyDecision
                    |
                    v
应用层：PublishReviewResultUseCase
  CI 日志 / 摘要评论更新 / 通知 / 退出码 / 反馈记录
                    |
                    v
基础设施层
  Git、GitHub、CodeUp、AI、SARIF、类型检查、测试、企业微信、存储
```

完整数据流：

```text
Committed range
  -> RawCommittedInput
  -> InputClassificationPolicy
  -> TrustedLocalInput / SanitizedModelInput / SanitizedOutput
  -> Analyzer[] (parallel, budgeted, isolated)
  -> ReviewCandidate[]
  -> FindingVerifier[]
  -> ValidatedFinding[] / SuppressedCandidate[]
  -> ReviewPolicy
  -> ReviewDecision
  -> Comment / notification / status / exit code
  -> Feedback + metrics
```

分析器失败不应覆盖已完成的分析结果。它们以独立的 `AnalyzerRun` 状态进入最终报告，由策略决定是否因某一类分析器不可用而使流水线失败。

### 3.1 数据分级与安全边界

```text
RawCommittedInput
  - 当前检出提交中的原始文件、diff 与真实路径
  - 仅供本进程内、受信任的确定性分析器读取
  - 禁止离开运行环境，禁止写入日志、评论、通知、指标和反馈存储

SanitizedModelInput
  - 删除敏感文件并脱敏内容、路径和凭据后的 DiffChunk
  - 仅供外部 AI 服务或其他远程分析器读取
  - 使用 chunkId、允许公开的路径和范围建立证据引用

SanitizedOutput
  - 用于日志、评论、通知、指标与反馈事件的最终安全视图
  - 不含密钥、敏感路径、敏感文件内容和完整 diff
```

密钥扫描、SAST、类型检查等本地受信任分析器可以读取 `RawCommittedInput`；这保证密钥扫描不会因预先脱敏而失效。AI 和任何远程服务只能接收 `SanitizedModelInput`。所有分析器的返回值、失败消息和验证证据都必须先转换为 `SanitizedOutput` 才能离开评审流水线。

## 4. 模块边界

```text
src/
  domain/
    review/
      model/                 # ChangeSet、Candidate、Finding、Evidence、Decision
      policy/                # 安全、去重、门禁、通知、评论策略
      service/               # 指纹、聚合、策略评估等纯业务逻辑
  application/
    review/
      use-cases/             # 执行评审、发布结果、记录反馈
      ports/                 # 所有外部能力的抽象
      contracts/             # 版本化结构化评审契约
      orchestration/         # 分析器调度、预算、验证编排、失败隔离
  infrastructure/
    scm/                     # Git、GitHub、CodeUp、未来 GitLab
    engines/                 # deepseek、openai、local-model
    analyzers/               # SARIF、ESLint、TypeScript、secret scan
    verifiers/               # diff、AST、typecheck、test execution
    delivery/                # GitHub/CodeUp 评论、企业微信等
    feedback/                # 反馈、运行记录、分布式锁实现
  interfaces/
    cli/
    github-action/
  bootstrap/
    create-review-dependencies.ts
```

依赖方向固定为：`interfaces -> application -> domain`，`infrastructure -> application/domain`。`bootstrap` 是唯一允许同时引用 application 与 infrastructure 的装配边界。

## 5. 统一领域模型

### 5.1 变更集、输入视图与可定位分块

```ts
interface ChangeSet {
  range: CommitRange;
  files: readonly ChangedFile[];
  chunks: readonly DiffChunk[];
  securitySummary: ChangeSecuritySummary;
}

interface DiffChunk {
  id: string;                 // 对仓库、范围、真实路径和安全内容摘要生成的稳定 ID
  path: SafeRepositoryPath;
  previousPath?: SafeRepositoryPath;
  status: ChangeStatus;
  newRange?: SourceRange;
  oldRange?: SourceRange;
  content: string;            // 已脱敏、已裁剪；不得在普通日志整体输出
  contentDigest: string;
}

interface SourceRange {
  startLine: number;
  endLine: number;
}
```

`ChangeSet` 仅存在于受信任运行边界内。`SanitizedModelInput` 从中投影出可安全发送给模型的 `DiffChunk[]`；`SanitizedOutput` 只保留允许公开的路径、范围、摘要和计数。敏感路径在内部过滤后只能以计数或不可逆标识出现，绝不转换为 `SafeRepositoryPath`。

`DiffChunk` 是外部分析器定位与证据的唯一来源。其 ID 由仓库标识、提交范围、真实路径摘要、旧/新范围和安全内容摘要以版本化算法生成；同一提交范围的重跑必须稳定，不同范围或不同内容不得冲突。它既保留本次提交边界，也允许按文件、语言、风险或模型上下文窗口做可预测分批。

### 5.2 候选、证据和最终发现项

```ts
interface ReviewCandidate {
  analyzer: AnalyzerIdentity;
  contractVersion: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  description: string;
  suggestion?: string;
  locations: readonly CandidateLocation[];
  evidence: readonly EvidenceClaim[];
  confidence?: number;        // 仅排序，不参与门禁
}

interface EvidenceClaim {
  chunkId: string;
  range?: SourceRange;
  excerptDigest?: string;     // 不保存原始敏感片段
  assertion: string;          // 说明该证据支持什么结论
}

interface VerificationEvidence {
  method: VerificationMethod;
  outcome: "passed" | "failed" | "not-applicable";
  reasonCode: string;
  safeDetails?: string;
}

interface ValidatedFinding extends ReviewCandidate {
  id: string;
  fingerprint: string;
  verification: FindingVerification;
}

interface FindingVerification {
  status: "grounded" | "verified" | "suppressed";
  evidence: readonly VerificationEvidence[];
}
```

`ReviewCandidate` 不是对用户可见的最终对象。完成安全、变更锚定和证据一致性检查的 `grounded` 发现可以进入摘要评论；获得确定性工具或可执行验证的 `verified` 发现可以参与门禁。`suppressed` 候选项只保留脱敏计数、分类和原因码。

状态聚合规则固定为：安全拒绝、找不到变更块、范围越界、证据摘要不一致或重复冲突时为 `suppressed`；仅完成锚定和证据一致性时为 `grounded`；任一适用的确定性验证通过时为 `verified`。单个验证器返回的是一条 `VerificationEvidence`，应用层负责聚合为 `FindingVerification`。

### 5.3 统一来源与严重级别

```ts
interface AnalyzerIdentity {
  kind: "ai" | "sast" | "linter" | "typecheck" | "test" | "secret-scan";
  id: string;                 // 例如 deepseek、codeql、eslint
  version?: string;
}

type InputAccess = "trusted-raw-local" | "sanitized-model-input";

interface AnalyzerCapabilities {
  inputAccess: InputAccess;
  supportsChangedOnly: boolean;
  supportsRepositoryScan: boolean;
}

type VerificationMethod =
  | "diff-anchor"
  | "source-range"
  | "ast"
  | "typecheck"
  | "static-rule"
  | "test-execution"
  | "human-feedback";
```

外部静态分析结果优先通过 SARIF 2.1.0 适配到内部模型。SARIF 是交换格式，不是领域模型：项目的领域语义、门禁和评论协议不得依赖任何特定工具的字段。

## 6. 端口与适配器

### 6.1 核心端口

```ts
interface ChangeSetProvider {
  collect(scope: ReviewScope): Promise<ChangeSet>;
}

interface ReviewAnalyzer {
  readonly identity: AnalyzerIdentity;
  readonly capabilities: AnalyzerCapabilities;
  analyze(request: AnalysisRequest): Promise<AnalyzerRunResult>;
}

interface FindingVerifier {
  readonly method: VerificationMethod;
  verify(candidate: ReviewCandidate, changeSet: ChangeSet): Promise<VerificationEvidence>;
}

interface SummaryCommentPort {
  upsert(comment: SummaryReviewComment): Promise<DeliveryResult>;
}

interface NotificationPort {
  publish(notification: ReviewNotification): Promise<DeliveryResult>;
}

interface ReviewQualityStore {
  recordRun(record: SanitizedReviewRunRecord): Promise<void>;
  recordFeedback(feedback: ReviewFeedback): Promise<void>;
}

interface ReviewExecutionLockPort {
  acquire(key: ReviewExecutionKey, lease: Duration): Promise<ReviewExecutionLease | undefined>;
}
```

`ReviewAnalyzer` 统一代替只表达 AI 的端口。首个 AI 实现仍可保留 `AiReviewPort` 作为兼容适配器，但新用例只能依赖 `ReviewAnalyzer`。

`inputAccess` 是强制安全约束：只有内置、受信任并在本地进程执行的分析器可声明 `trusted-raw-local`；任何远程分析器只能声明 `sanitized-model-input`。注册表必须在装配时拒绝不满足该约束的实现。

### 6.2 AI 引擎适配

所有 AI 引擎使用同一个版本化 `StructuredReviewContract`：

```ts
interface StructuredReviewContract {
  version: "v1";
  instruction: ReviewInstruction;
  input: SafeReviewInput;
  outputSchema: JsonSchema;
}
```

- `ReviewInstruction` 定义评审原则、语言、禁止事项和证据要求；它是平台无关的共享契约。
- AI 适配器只负责将该契约转换为供应商 API（Chat Completions、Responses 或其他协议）并解析响应。
- `outputSchema` 与运行时 schema 校验同源，避免提示词 JSON 形状、解析器与领域模型漂移。
- 模型特有参数（模型名、超时、重试、温度、响应格式）保留在适配器配置中，不泄漏到领域层。

新模型的接入步骤固定为：实现适配器 -> 声明能力 -> 注册到 bootstrap -> 增加契约兼容测试。不得修改领域模型、政策或 CLI 主流程。

### 6.3 分析器注册表

```ts
interface AnalyzerRegistry {
  resolve(enabled: readonly AnalyzerSelector[]): readonly ReviewAnalyzer[];
}
```

注册表由 bootstrap 构建，配置只选择已注册分析器及其参数。这样支持多个 AI、SAST 和确定性检查并行，又避免把未经审核的第三方代码作为运行时插件加载。

### 6.4 分析器调度与资源预算

每次运行由 `AnalyzerExecutionPlan` 明确其分析器集合和失败语义：

```ts
interface AnalyzerExecutionPlan {
  analyzerId: string;
  required: boolean;
  scope: "changed-only" | "repository";
  timeoutMs: number;
  retryCount: number;
  maxInputBytes?: number;
  failureMode: "fail" | "degrade" | "skip";
}

interface ReviewRunBudget {
  totalTimeoutMs: number;
  maxConcurrency: number;
  maxAiInputBytes: number;
  maxAiRequestCount: number;
}
```

调度器必须限制总并发、总时限和 AI 请求预算，并在预算不足时优先保留必需的确定性分析器。每个分析器产生独立的 `AnalyzerRun`，状态为 `completed`、`degraded`、`skipped` 或 `failed`。只有 `required` 且 `failureMode: "fail"` 的失败才能使评审执行失败；其他失败只进入脱敏运行摘要。

分析范围和报告范围必须分离：SAST、类型检查可在当前已检出的完整提交上分析，但默认仅发布与本次变更块相关的发现。仓库级发现必须由策略显式允许，并标记为 `repository-level`，不得伪装成本次变更的行级结论。

## 7. 验证流水线

验证是一个可组合的链，而不是单一正则过滤器：

1. **安全验证**：确认路径、内容和证据不包含被排除的敏感信息。
2. **变更锚定**：`chunkId` 存在，文件与行范围属于本次变更。
3. **证据一致性**：引用摘要与已脱敏分块内容一致，避免模型凭空描述源代码。
4. **语法/AST 验证**：适用于可由 AST 或语义分析确认的声明、调用、类型和控制流问题。
5. **确定性工具验证**：匹配 SAST、Lint、类型检查或密钥扫描的同类结论。
6. **可执行验证**：运行受限的测试、复现用例或修复前后检查；执行环境必须有超时、资源限制和隔离策略。

不同类别需要不同验证强度：

| 发现类型 | 最低验证 | 可阻断条件 |
| --- | --- | --- |
| 密钥、安全规则、类型、Lint | 工具结果 + 范围锚定 | 确定性工具确认 |
| 明确 API/语法错误 | 范围锚定 + AST/类型检查 | AST 或类型检查确认 |
| 逻辑、并发、性能风险 | 范围锚定 + 证据一致性 | 有可执行复现或显式项目策略 |
| 设计与可维护性建议 | 范围锚定 | 默认不阻断 |

同一候选会累积多个验证证据。策略只读取最终状态和验证方法，不读取供应商特定错误文本。发现去重先以安全路径、范围、类别和规范化语义建立关联组，再保留所有来源证据；不得仅取多个来源中的最高严重级别。最终严重级别由策略根据类别、验证强度和项目规则决定。

## 8. 策略、门禁与投递

```ts
interface ReviewDecision {
  gate: "passed" | "failed" | "advisory" | "execution-failed";
  findings: readonly ValidatedFinding[];
  suppressedCandidateCounts: Readonly<Record<SuppressionReason, number>>;
  deliveries: readonly PlannedDelivery[];
}
```

策略按以下优先顺序判断：

1. 分析器或基础设施的执行失败是否应阻断。
2. 已验证发现是否命中该仓库、分支和事件的 `fail_on` 规则。
3. 评论、通知和 CI 日志是否投递；投递失败按各渠道重试与阻断策略处理。
4. 将稳定、脱敏的 `ReviewDecision` 映射为既有三位退出码。

门禁资格固定为：`finding.verification.status === "verified"` 且发现严重级别命中仓库、分支和事件的 `fail_on_verified` 策略。`grounded` 的 AI 语义发现可评论、可通知，但绝不因模型置信度或单独的项目开关而阻断流水线。

摘要评论仍是唯一的首期平台评论形式。它包含评审范围、分析器状态、已验证发现统计、门禁结果和投递状态。它不输出被过滤的敏感路径、内容或完整证据片段。

评论使用如下可更新协议：

```md
<!-- ai-code-review:result:v1 review-id={provider}:{repository}:{pull-or-merge-request-number} -->
<!-- ai-code-review:run:{run-id} -->
<!-- ai-code-review:revision:{head-sha}:{configuration-digest}:{contract-version} -->

## AI Code Review
- Decision: advisory
- Verified findings: 2
- Filtered candidates: 3
- Analyzer status: deepseek=completed, eslint=completed
```

`reviewId` 标识同一个 PR/MR，因此新提交更新同一条摘要评论；`revision` 标识一次特定变更、配置和契约组合；`runId` 标识单次执行。`findingFingerprint` 由安全路径摘要、类别、规范化标题、变更块 ID 和相关范围生成。相同发现跨同一 revision 重跑保持稳定，不同 commit 的发现不能错误覆盖。

接口层应使用平台原生的工作流并发控制，按 `{provider}:{repository}:{pull-or-merge-request-number}` 串行评审。跨平台或跨执行器部署时，通过 `ReviewExecutionLockPort` 取得带租期的锁。评论端口执行条件更新；无锁发生竞争时允许后续运行收敛重复评论，但不得声称完全无重复。

### 8.1 三位退出码映射

| 退出码 | 含义 |
| --- | --- |
| `0` | 评审完成，未触发质量门禁 |
| `100` | 已验证发现触发质量门禁 |
| `101` | CLI 参数或事件输入错误 |
| `102` | 配置或凭据错误 |
| `103` | Git 范围或变更集获取错误 |
| `104` | 必需确定性分析器执行失败 |
| `105` | 必需验证器执行失败 |
| `106` | 结果聚合或内部契约错误 |
| `107` | 显式请求的脱敏运行记录或人工反馈写入失败 |
| `110`–`119` | AI 执行失败的既有细分语义 |
| `120` | 必需评论投递失败 |
| `121` | 必需通知投递失败 |

退出码表达失败类别，绝不表达具体 AI 提供方。advisory 分析器失败默认只进入脱敏运行摘要，不返回非零退出码。

## 9. 反馈与质量度量

系统需要支持人工对最终发现项记录：`accepted`、`false-positive`、`not-applicable`、`fixed`。反馈不直接修改模型输出，而是形成审计记录和聚合指标。

评论不是反馈的真相来源。跨仓库质量度量的生产实现是组织受控的 `ReviewQualityStore`：CLI/Action 通过签名 HTTPS 事件提交脱敏运行记录和反馈，再由组织受控存储保存。GitHub/CodeUp 评论、Reaction 或未来反馈入口只负责收集用户意图，必须转换为以 `findingFingerprint` 为键的反馈事件后才写入存储。

本地 JSONL 可保存仅含指纹、固定状态、运行 ID 和时间的人工反馈事件，并计算单仓库脱敏聚合指标；它不是跨仓库质量度量的真相来源。计算反馈比率时，同一指纹以最新反馈状态为准，且只有能关联本地发现的反馈才能参与比率。未配置 `ReviewQualityStore` 时，跨仓库指标能力必须显式禁用，工具不能声称具有长期误报率统计。反馈记录须定义保留期限、删除流程、访问权限和签名验证策略。

最小指标维度：

- 分析器、模型和契约版本；
- 编程语言、规则类别、严重级别；
- `verificationStatus` 和验证方法；
- 发现量、评论量、被阻断次数；
- 人工接受率、误报率、重复率、平均处理时间；
- 分析器失败率、耗时和 token/成本区间。

指标只保存脱敏维度与聚合值。原始 diff、密钥、敏感路径和完整模型输入不能进入指标存储。

反馈闭环用于：调整提示词、启停低质量分析器、优化类别策略和评估模型升级；不得在没有人工审核的情况下自动修改仓库规则或自动合并代码。

## 10. 配置与能力治理

配置按能力而不是厂商字段组织：

```yaml
analyzers:
  - id: deepseek
    enabled: true
    role: semantic-review
  - id: typescript
    enabled: true
    role: deterministic-check

verification:
  required_for_comment: grounded
  required_for_gate: verified
  enabled_methods: [diff-anchor, source-range, typecheck]

gate:
  fail_on_verified: [critical, high]

execution:
  total_timeout_ms: 300000
  max_concurrency: 3
  max_ai_request_count: 8

analyzer_plans:
  deepseek:
    required: false
    scope: changed-only
    timeout_ms: 60000
    failure_mode: degrade
  typescript:
    required: true
    scope: repository
    timeout_ms: 120000
    failure_mode: fail
```

具体密钥仍只从环境变量或 Secret 注入。配置解析后必须校验：已启用的分析器是否注册、所需能力是否可用、被选择的验证方法是否兼容当前运行环境、`scope` 是否被该分析器支持，以及预算是否为正数。配置不得提供绕过 `verified` 状态的 AI-only 门禁开关。

## 11. 可靠性、可观测性与安全

- 每个 `AnalyzerRun` 有独立超时、重试、错误分类和脱敏诊断信息。
- 调度器强制执行全局 deadline、最大并发、最大 AI 请求数和输入大小预算；取消或降级必须保留原因码。
- 通知和评论失败均重试 2 次、默认不阻断，并在最终 CI 投递状态中写入脱敏状态和总尝试次数。
- 每次运行生成 `runId`，串联分析、验证、策略与投递日志；不记录完整 diff。
- 使用结构化日志字段：`runId`、事件类型、分析器 ID、耗时、候选数量、验证状态计数、退出码。
- 可选接入 OpenTelemetry 时，仅由基础设施层导出 trace/metric；领域模型不依赖可观测性 SDK。
- 所有外部响应在进入日志、评论和反馈仓库前执行统一脱敏；脱敏实现必须保持程序语法，例如不能把 `===` 改写为赋值表达式。

## 12. 测试策略

每个边界都应有契约测试：

- `ChangeSetProvider`：提交范围、重命名、删除、敏感文件、分块与行映射。
- 输入分级：密钥扫描可读取本地原始输入、AI 只能读取安全输入、任何输出不得恢复敏感路径或内容。
- `ReviewAnalyzer`：共享输出契约、非法 JSON、schema 不匹配、模型错误映射。
- `FindingVerifier`：不存在 chunk、越界行号、摘要不一致、敏感证据、工具确认和测试失败。
- `ReviewPolicy`：不同事件、验证状态、严重级别和投递失败下的决策与退出码。
- 调度器：并发上限、总预算、required/advisory 失败、取消、仓库级扫描与变更范围过滤。
- SCM/通知适配器：摘要评论幂等更新、权限不足、网络失败、脱敏日志。
- 质量存储与锁：反馈指纹、事件签名、保留策略、租约过期和并发评论更新。
- 端到端测试：本地 Git 仓库 -> 固定分析器响应 -> 验证 -> 评论渲染 -> 退出码。

使用固定的安全 fixture 模拟模型响应；真实 API 连通测试与常规单元测试隔离，只有显式配置凭据时才执行。

## 13. 迁移路线

迁移必须保持已有 CLI、GitHub Action、DeepSeek 配置和摘要评论协议可用。

当前实现已经完成原始/安全输入分级、候选项的 diff 锚定、行范围与证据一致性校验、分析器注册与预算调度，以及来源受控的确定性验证接线。调度器只向声明 `trusted-raw-local` 的已注册本地分析器传递原始已提交 diff；`ai` 身份分析器被强制限定为安全输入，并受每个请求的安全 JSON diff 字符预算约束，超限时仅接收按变更顺序截取的前缀分块。`DeepSeek` 仍只会产生 `grounded` 发现；已接入的本地 TypeScript 分析器、SARIF 2.1.0 报告适配器和高置信度密钥扫描器只将本次新增 diff 行的确定性诊断升级为 `verified` 并参与质量门禁。密钥扫描器只输出安全锚点与通用说明，敏感路径和原始值不离开本地边界。输出发现已具有仅基于安全定位与规范化语义的稳定指纹；同次运行的等价发现会合并来源与验证方法。可选 JSONL 记录器保存带类型标识的运行摘要，并可追加只含固定状态、指纹、运行 ID 与时间的人工反馈事件；本地指标命令只输出这些记录的脱敏聚合值，不提供跨仓库指标。GitHub 示例工作流按 PR 编号串行运行，评论与通知失败都最多尝试三次并将最终脱敏状态写入 CI 日志。ESLint、CodeQL 与 Semgrep 可沿用同一边界接入，不能通过伪造 AI 输出或配置开关绕过该边界。

1. 引入 `RawCommittedInput`、`SanitizedModelInput`、`SanitizedOutput`、`ChangeSet` 与 `DiffChunk`，为现有 `CodeChange` 提供兼容映射。
2. 引入 `ReviewCandidate`、`VerificationEvidence`、`ValidatedFinding` 与状态聚合器，为现有 `ReviewFinding` 提供兼容映射。
3. 将公共提示词与 JSON Schema 收敛为 `StructuredReviewContract`；DeepSeek 成为首个仅接收安全输入的 `ReviewAnalyzer`。
4. 加入 `diff-anchor` 和 `source-range` 验证器，使无依据候选不再对外输出；门禁改为仅接受 `verified` 发现。
5. 引入分析器注册表、能力声明、执行计划和预算；接入 TypeScript/ESLint、SARIF 或其他确定性分析器。
6. 补齐通用分析器/验证器退出码，以及 PR/MR 级并发控制和评论条件更新。
7. 增加运行记录、稳定发现指纹、质量存储和人工反馈端口。
8. 在验证体系稳定后，再评估 AST 验证、受限测试执行、GitLab、更多模型和行级评论。

每一步都必须有兼容测试和回归测试；不得在未完成相应验证前启用 AI-only 阻断。

## 14. 不采用的方案

- **仅提高提示词或让第二个模型复审**：可以降噪，但不能证明结论为真，不能作为质量门禁基础。
- **按 AI 提供方定义退出码或领域分支**：供应商数量会扩张，且错误语义无法复用；退出码应描述失败类别。
- **将平台 API、模型 HTTP 调用放进用例**：会让 GitHub、CodeUp、DeepSeek 等差异污染核心逻辑。
- **立刻拆分微服务或运行时插件市场**：当前没有独立部署、租户隔离或第三方执行代码的需求，复杂度高于收益。
- **保存完整 diff 作为审计证据**：不满足敏感信息约束；应保存安全引用、摘要、哈希和必要的元数据。

## 15. 架构验收标准

- 新增一个模型、SAST 工具、验证器、通知渠道或 SCM 平台时，领域模型和核心评审用例无需修改。
- 每条输出到评论、通知或门禁的发现都能映射到本次已提交变更，并具备脱敏证据。
- AI 自报置信度不能单独触发门禁。
- AI 或其他远程服务无法读取原始 diff、敏感路径、敏感文件内容或凭据；受信任本地扫描器仍可在不外泄的条件下扫描原始提交内容。
- 只有 `verified` 发现可阻断；`grounded` 发现只能评论或通知。
- 并行分析器运行受全局时限、并发和预算约束，required/advisory 失败具有不同且可测试的策略。
- 确定性分析器失败、AI 失败、评论失败、通知失败具有独立且明确的状态、策略和三位退出码映射。
- 同一变更重复执行更新同一摘要评论；同一发现具有稳定指纹。
- 同一 PR/MR 的并发运行通过平台并发控制或租约锁串行化；无锁竞争具有明确的最终一致性修复行为。
- 所有日志、评论、反馈和指标均不泄露密钥、敏感路径、敏感文件内容或完整 diff。
- 误报率、接受率、分析器失败率和投递失败率可按分析器与类别追踪。
