# AI 评审质量优化架构

> 状态：已决策，待分期实施；关联 [Issue #10](https://github.com/lavyoung/ai-code-review/issues/10)。
>
> 本文是 [可验证 AI 代码评审架构](./REVIEW-QUALITY-ARCHITECTURE.md) 的专项增量设计，
> 解决“模型引用了改动，但结论仍然错误”的误报问题。它适用于任意仓库中的代码、构建与自动化配置；
> GitHub Actions 只是首个适配器，不是领域模型。

## 1. 背景与问题

当前评审能将模型发现锚定到本次已提交的安全 DiffChunk。这能避免模型评论不存在的文件或行号，
但不能证明模型的推论为真。典型误报包括：

- 将 README、设计文档中的 YAML 示例当作实际会执行的 CI 配置；
- 仅凭模型记忆判断外部 Action、容器或依赖的版本、SHA 或官方行为；
- 只看到被截断 diff 的一部分，便推断跨文件配置、权限或 checkout 行为；
- 将“建议核实”写成“已确认的高危缺陷”。

因此，`grounded` 只能表示“结论引用了本次改动的证据”，不能表示“结论已被证实”。
本设计把**事实、推断与最终发现**分离，让确定性工具和可信事实源负责证明，让 AI 负责解释影响与提供人工审查建议。

## 2. 目标、非目标与不可违反原则

### 2.1 目标

1. 将 AI 语义建议的错误断言降为 `advisory` 或 `unverifiable`，避免伪装成已确认缺陷。
2. 在不绑定 GitHub 的前提下，解析仓库内可执行自动化配置，并提供统一的安全事实和规则能力。
3. 让 AI 根据已提取的事实分析改动影响，而不是自行猜测平台、版本或运行时行为。
4. 用人工反馈和版本化评测集持续度量准确率，指导规则、上下文、提示词和模型迭代。
5. 保持现有安全边界：原始 diff、密钥、敏感路径和敏感内容不进入远程模型、日志、评论或反馈存储。

### 2.2 非目标

- 不把 AI 文本变成自动合并或自动修复依据。
- 不在首期实现运行时插件市场、通用 YAML 执行器或全仓库知识图谱。
- 不为每个 CI 平台复制一套领域规则；平台差异只能位于解析和外部事实适配器。
- 不因接入自动化配置分析而允许 fork PR 执行不可信代码或读取密钥。

### 2.3 决策原则

- **事实先于结论**：没有可信事实源时，模型不能声称外部事实成立。
- **验证策略由系统拥有**：模型、规则适配器和外部事实源都不能自行决定门禁资格或最低验证要求。
- **可执行与文档分离**：只对被识别为仓库有效执行入口的文件运行自动化安全规则。
- **AI 解释事实，不制造事实**：AI 可描述影响、提出假设和修复路径；事实型结论必须可复核。
- **未知保持未知**：外部查询不可用、上下文不足或解析失败时输出明确的不确定状态，不用猜测填补。
- **输入均为数据**：代码、注释、PR/MR 描述、配置值和工具输出均为不可信数据，不能改变系统指令或获取额外能力。
- **质量可度量**：提示词或模型的变更必须通过固定样本和人工反馈指标评估后再扩大使用。

## 3. 目标处理流程

```text
Committed Git range
  -> 输入安全过滤与文件分类
  -> 确定性事实提取 ──────> 事实证据库
  -> 按需上下文组装 ──────> 安全 ReviewContextPackage
  -> AI 影响分析（只引用事实和上下文证据）
  -> 断言验证、矛盾检查、去重与降级
  -> 策略、评论、通知、门禁
  -> 人工反馈与离线评测
```

每一阶段都输出版本化、脱敏的元数据。原始提交内容仅留在受信任本地分析阶段；远程模型只能接收
`SanitizedModelInput` 及其安全上下文投影。

## 4. 领域模型扩展

现有 `ReviewCandidate -> Evidence -> Verification -> Finding` 主线保留。以下对象补足“引用证据”和
“结论正确”之间的语义鸿沟。

```ts
type EvidenceStatus =
    | "anchored"       // 已定位到本次改动，尚未验证结论
    | "corroborated"   // 多个独立受控来源支持
    | "verified"       // 满足系统定义的确定性验证策略
    | "unavailable";   // 所需事实、上下文或验证器不可用

type FindingDisposition =
    | "defect"         // 仅在 verified 且策略允许时进入门禁
    | "advisory"       // 人工审查建议，绝不阻断
    | "unverifiable"   // 仅显示限制或详细报告，绝不宣称缺陷
    | "suppressed";    // 不安全、矛盾、重复或不适用，不对外显示

interface ReviewFact {
    id: string;
    kind: FactKind;
    value: SafeFactValue;
    source: FactSource;
    evidence: readonly EvidenceReference[];
    verification: "confirmed" | "unavailable" | "inconclusive";
}

interface ReviewAssertion {
    id: string;
    author: "rule" | "ai";
    claimType: AssertionType;
    claim: string;
    factIds: readonly string[];
    contextEvidenceIds: readonly string[];
    uncertainty: "none" | "context-limited" | "external-fact-required";
}

interface AssertionPolicy {
    claimType: AssertionType;
    requiredFactKinds: readonly FactKind[];
    requiredVerification: readonly VerificationMethod[];
    gateEligible: boolean;
}

type AssertionType =
    | "impact-closure"
    | "regression-risk"
    | "contract-compatibility"
    | "test-obligation"
    | "security-risk"
    | "design-maintainability";
```

`ReviewAssertion` 不是用户可见的最终发现。验证器只有在其引用事实存在、文件分类适用、证据范围匹配，
且不存在矛盾事实时，才能将断言转换为 `ReviewFinding`。

`AssertionPolicy` 仅由受控的系统策略注册表提供。AI 可以提出 `claimType`，但不能填写验证方法、严重级别、
门禁资格或最终处置；系统根据该类型选择最低事实和验证要求。多个来源只有在来源、实现或输入独立时才能形成
`corroborated`，同一个模型或由同一原始文本派生的多份输出不能互相验证。

每个 `AssertionType` 都必须声明最低上下文：`impact-closure` 需要变更锚点和完整影响边，`regression-risk` 需要
影响路径和基线比较，`contract-compatibility` 需要契约差异与兼容策略，`test-obligation` 需要测试义务和测试发现
状态。上下文不足时，系统只能产生 `advisory` 或 `unverifiable`，不能产生 `defect`。

最终发现同时携带 `EvidenceStatus` 和 `FindingDisposition`。只有 `evidenceStatus === "verified"`、
`disposition === "defect"` 且命中系统策略的发现可参与门禁。现有内部 `grounded` 状态在迁移期映射为
`evidenceStatus: "anchored"` 与 `disposition: "advisory"`；它是证据锚定状态，不是正确性标签。

## 5. 文件分类和通用自动化配置 IR

### 5.1 文件分类优先

任何 YAML、JSON、TOML、Groovy 或脚本文件在进入自动化规则前，必须由 `RepositoryFileClassifier` 分类：

| 分类 | 例子 | 自动化安全规则 |
| --- | --- | --- |
| `executable-automation` | 已识别的 CI 工作流、流水线定义 | 仅在 `active` 时适用 |
| `automation-template` | 明确被平台加载的模板或可复用定义 | 仅在可达时适用，标记模板上下文 |
| `documentation-example` | README、`docs/**`、Markdown 代码块 | 不适用 |
| `unknown-configuration` | 未识别配置 | 仅做通用语法检查，不推断安全风险 |

分类结果必须包含 `reachability: active | inactive | unknown`、分类依据和解析状态。分类依据应组合路径、
平台入口约定、调用关系和文件内容；不能仅因文件含有 `uses:`、`steps:` 或 YAML 键值就把它视为可执行。
`unknown` 不触发确定性安全缺陷，也不能静默按文档处理；它只能生成带依据的“需人工确认可达性”建议。

解析器只解析数据，不执行脚本、表达式、模板或 include。它必须限制单文件大小、嵌套深度、YAML alias 数量、
解析时间和 include 链长度，并检测循环引用。分类、可达性和限制命中结果本身都是可展示的事实证据。

### 5.2 平台无关 IR

平台解析器将文件转为统一 `AutomationDefinition`，领域规则不直接读取任何平台 YAML：

```ts
interface AutomationDefinition {
    platformId: string;
    source: AutomationSource;
    reachability: "active" | "inactive" | "unknown";
    capabilities: readonly AutomationCapability[];
    platformFacts: readonly ReviewFact[];
    triggers: readonly AutomationTrigger[];
    jobs: readonly AutomationJob[];
    externalReferences: readonly ExternalReference[];
}

interface AutomationJob {
    id: string;
    permissions: readonly PermissionGrant[];
    trustBoundary: "trusted" | "untrusted" | "mixed" | "unknown";
    steps: readonly AutomationStep[];
}

interface ExternalReference {
    kind: "action" | "reusable-workflow" | "container" | "plugin" | "script";
    reference: string;
    immutability: "pinned" | "mutable" | "unknown";
    resolution?: ExternalReferenceResolution;
}
```

首批通用规则只依赖该 IR：

- 不可信输入与密钥、写权限或持久化凭据是否处于同一执行边界；
- 外部引用是否可变、未知或已固定；
- checkout 是否具有可验证的提交来源；
- 工作流是否声明超出需求的权限；
- 是否出现高风险触发器与特权执行组合。

平台实现按适配器增加：GitHub Actions、GitLab CI、CodeUp、Jenkins Pipeline、Azure Pipelines。新增平台通常只新增
`AutomationParserAdapter`、平台入口识别器、能力声明和契约测试；无法无损映射的平台语义必须显式产出
`platformFacts` 或 `unknown`，不得伪装成通用语义。平台特有规则允许存在于基础设施规则包，但只能产出统一的
`ReviewFact` 和 `ReviewAssertion`；核心策略和领域模型不得出现 `if (platformId === "github")` 分支。

## 6. 外部事实核验

模型不得凭训练记忆判断“某 SHA 是否属于某版本”“某镜像是否有漏洞”或“平台 API 的真实语义”。这类判断必须经
`ExternalFactResolver` 获得可追溯结果：

```ts
interface ExternalFactResolver {
    readonly kind: "action-provenance" | "container-provenance" | "package-metadata";
    resolve(request: ExternalFactRequest): Promise<ExternalFactResolution>;
}
```

- 解析成功：产生包含来源身份、查询时间、TTL、不可变标识、缓存状态和安全摘要的 `confirmed` 事实。
- 网络、权限、速率限制或来源不受信任：产生 `unavailable`/`inconclusive`，不产生安全缺陷。
- 依赖锁文件、签名或平台原生元数据可作为本地可复现证据；不记录令牌或完整远程响应。

解析器只能访问系统配置的官方 API、受信任注册表或允许列表中的镜像仓库；不得把 PR 中的 URL、owner、仓库名或
重定向目标直接作为任意网络请求。请求不携带仓库 Token、模型凭据或其他用户密钥，必须限制超时、响应大小、
重定向次数和缓存 TTL，并验证返回的主体身份与被解析引用一致。缓存键同时包含来源身份、不可变引用和解析器版本，
不能被不可信 PR 的可变文本污染。

例如文档中的 `actions/checkout@v4` 只能被报告为“文档示例采用可变标签，建议按项目文档策略统一”，
绝不能被称为正在运行的工作流漏洞；只有可执行工作流被解析、引用可变且规则启用时，才可产生确定性发现。

## 7. 上下文包与 AI 职责

`ReviewContextPackage` 由应用层在总预算内构造，取代单纯按字符截断的 diff 前缀：

- 当前 hunk 及所在函数、类、任务或配置 job 的完整安全片段；
- 通过 import、调用、配置引用、Action 本地路径或流水线 include 关联的最小上下文；
- 已确认的 `ReviewFact` 与明确的 `unavailable` 事实；
- 评审范围、语言、文件分类和未纳入上下文的原因。

上下文按风险和关联度排序，不能发送完整仓库。若预算不足，系统必须保留“缺失上下文”声明，让模型输出
`context-limited`，而不是假装已完成跨文件检查。

关联的未改动文件仅用于解释改动，不能独立成为本次评审的报告位置或缺陷对象。每个对外 `ReviewFinding` 必须至少
引用一个本次提交范围内的 `DiffChunk`；若风险只存在于历史代码而与改动无可证明的触发关系，应抑制或作为仓库级
观察项单独处理，不能伪装成当前 PR/MR 的缺陷。上下文选取算法、预算单位、排序版本和缺失原因必须记录在运行摘要中。

AI 的结构化契约调整为“断言协议”：

1. 每条 AI 输出必须列出 `factIds` 或 `contextEvidenceIds`；
2. 事实型说法必须声明“需要验证”；具体验证方式只能由系统的 `AssertionPolicy` 选择；
3. 无法证明的内容使用 `advisory` 或 `needs-verification`；
4. 禁止仅凭版本号、SHA、文档片段或模型记忆断言漏洞、编译失败、链接失效或平台行为；
5. AI 主要输出影响解释、风险路径、边界条件、修复建议和人工复核问题。

提示词、JSON Schema 和运行时解析器必须共享同一个版本化 `StructuredReviewContract`。

所有进入模型的仓库内容、PR/MR 描述、工具诊断和外部元数据必须带来源标签并作为不可执行数据段，与系统指令和
JSON Schema 使用不可混淆的结构化边界。模型没有 Shell、网络、仓库读取或密钥访问能力；输出只能引用已分配的
事实和证据 ID。模型输出在渲染评论前仍须经过 Schema 校验、脱敏、链接/提及安全处理和提示注入回显检查。

## 8. 变更影响、业务上下文与测试义务

### 8.1 能力边界

系统的目标是对“本次改动是否已覆盖已知影响路径”给出可追溯判断，而不是宣称能证明不存在所有缺陷。
代码变更、静态关系、契约、测试和覆盖报告只能提供有限证据；AI 对业务行为、回归和缺失测试的判断默认是
`advisory`，除非具有适用的独立验证证据。

影响分析与报告范围必须分离：可以读取同一已检出提交中的关联文件来构建影响图，但所有对外的当前改动结论仍须
锚定本次 `DiffChunk`。历史问题、未关联的测试失败和无法解释的仓库级风险不能伪装成当前 PR/MR 的回归。

### 8.2 业务上下文来源与信任顺序

业务上下文不能由模型从命名或注释中自行猜测。`BusinessContextResolver` 必须按以下顺序使用受版本控制、可定位的来源：

| 来源 | 可信用途 | 不可作为的用途 |
| --- | --- | --- |
| 代码语义索引 | 调用、引用、继承、接口实现、路由、DTO、SQL、配置键、消息事件 | 推断未声明的业务规则 |
| 版本化契约 | OpenAPI/AsyncAPI、JSON Schema、数据库迁移、权限策略 | 断言运行时流量或消费者一定存在 |
| 业务能力目录 | 模块、接口、事件、表到稳定业务能力 ID 的映射 | 覆盖缺失或过期的技术依赖 |
| PR/MR 描述、Issue、注释 | 检索提示和人工审查背景 | 确定性事实或门禁依据 |

调用方可以在仓库中维护 `docs/context/capabilities.yml`、`docs/context/contracts/` 与
`docs/context/architecture/`。每条业务映射必须包含稳定 ID、来源文件、版本摘要、维护状态、责任 owner、
审核时间和过期时间。例如：

```yaml
id: order-payment
owner: payment-platform
reviewedAt: 2026-09-04
expiresAt: 2027-03-04
authority: approved
```

不存在、过期、没有 owner、未经批准或引用的模块/契约已不存在时，系统只报告 `business-context-unavailable`，
不得虚构业务影响或把过期映射当作门禁事实。

### 8.3 变更影响图

```ts
interface ChangeImpact {
    id: string;
    changeAnchorId: string;
    kind:
        | "local-behavior"
        | "public-api"
        | "data-contract"
        | "persistence"
        | "authorization"
        | "configuration"
        | "workflow";
    paths: readonly ImpactPath[];
    businessCapabilities: readonly BusinessCapabilityReference[];
    closure: ImpactClosure;
    evidence: readonly EvidenceReference[];
}

interface ImpactClosure {
    implementation: "addressed" | "unaddressed" | "unknown";
    compatibility: "demonstrated" | "not-demonstrated" | "unknown";
    validation: "demonstrated" | "partial" | "not-demonstrated" | "not-assessable";
}

interface ImpactNodeReference {
    symbol: SymbolIdentity;
    revision: string;
    kind: "method" | "type" | "route" | "contract" | "event" | "configuration" | "persistence";
}

interface SymbolIdentity {
    language: string;
    qualifiedName: string;
    signature?: string;
    sourceDigest: string;
    stableId: string;
}

interface ImpactPath {
    nodes: readonly ImpactNodeReference[];
    edges: readonly ImpactEdge[];
    completeness: "complete" | "partial" | "unknown";
}

interface ImpactEdge {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: "calls" | "implements" | "serializes" | "publishes" | "consumes" | "configures";
    evidence: readonly EvidenceReference[];
    completeness: "complete" | "partial" | "unknown";
}
```

`SemanticImpactIndexPort` 负责从已提交代码中提取语言语义关系；首批实现为 TypeScript 和 Java，后续语言只能通过
适配器加入。`ContractCatalogPort` 负责解析版本化 API、事件、Schema、迁移与权限契约。影响图必须保留每条边的
来源与解析能力；索引不支持的动态反射、运行时加载或外部消费者必须标记 `unknown`，不能被当作“没有影响”。
`SymbolIdentity` 必须支持 base/head 间的重命名、移动、重载和实现替换：适配器先使用语言级限定名与签名，再使用
受控的语义匹配和来源摘要；存在多个候选或无法确定时必须断开为 `unknown`，不能强行合并影响节点。

```ts
interface SemanticImpactIndexPort {
    analyze(changeSet: ChangeSet): Promise<readonly SemanticRelation[]>;
}

interface ContractCatalogPort {
    compare(range: CommitRange): Promise<readonly ContractChange[]>;
}

interface BusinessContextPort {
    resolve(references: readonly ContextReference[]): Promise<readonly BusinessCapabilityReference[]>;
}

interface TestInventoryPort {
    discover(revision: CommitRevision): Promise<TestInventory>;
}

interface RevisionBehaviorComparator {
    compare(request: RevisionComparisonRequest): Promise<RevisionComparison>;
}
```

这些端口位于应用层；语言解析、测试框架、覆盖格式、受控沙箱和业务目录均是基础设施适配器。领域层只消费
`ChangeImpact`、`TestObligation`、`ImpactCoverage` 和 `RevisionComparison`，不依赖 Java、TypeScript、JUnit、
Vitest、GitHub 或任何具体 CI 平台。

影响闭环必须从三个维度报告：`implementation` 表示已知影响节点是否有对应实现处理，`compatibility` 表示已知消费者
是否有兼容证据，`validation` 表示测试或其他验证是否证明影响路径。它们不得相互替代：代码已改不代表消费者兼容，
消费者兼容也不代表测试已证明行为。任一 `unknown` 都表示图、契约或业务上下文不完整，不是“没有影响”结论。

### 8.3.1 契约兼容性与外部消费者

`ContractCatalogPort` 只负责发现契约差异，兼容性结论由受控的 `CompatibilityPolicy` 决定。策略按 API、事件、
Schema 与数据库迁移类别，定义字段新增/删除/重命名、默认值、版本范围、向前/向后兼容和迁移回滚的机械判定规则。
它必须有版本号，并作为 `contract-compatibility` 断言的证据。

当前仓库外的已知 SDK、服务和事件消费者由 `ExternalConsumerCatalog` 显式登记，至少包含消费者 ID、契约类型、
支持版本范围、来源仓库或制品、快照版本、可访问范围、owner、审核时间、过期时间和维护状态。读取目录或消费者
制品时必须记录其不可变 revision；无法列出、不可读取、超出授权范围或已过期的外部消费者一律保持 `unknown`；
系统只能报告“已知消费者覆盖状态”，不得声称已覆盖所有生产消费者。对于契约或迁移变更，适用的双版本序列化、消费者契约或迁移前后验证结果构成
`CompatibilityEvidence`；仅“发现差异”不能成为兼容性缺陷。

### 8.4 测试义务、测试发现与影响覆盖

```ts
interface TestObligation {
    id: string;
    impactId: string;
    kind:
        | "happy-path"
        | "boundary"
        | "error-path"
        | "contract"
        | "authorization"
        | "persistence"
        | "compatibility";
    rationale: string;
    requiredEvidence: readonly EvidenceRequirement[];
}

interface ImpactCoverage {
    obligationId: string;
    status: "demonstrated" | "partial" | "not-demonstrated" | "not-assessable";
    evidence: readonly EvidenceReference[];
}

interface TestCoverageEvidence {
    testId: string;
    framework: string;
    revision: string;
    result: "passed" | "failed" | "skipped" | "unavailable";
    coverageKind: "line" | "branch" | "contract" | "integration" | "migration";
    association: "call-graph" | "contract-reference" | "coverage-report" | "approved-manual";
    evidence: readonly EvidenceReference[];
}

interface TestReliabilityEvidence {
    testId: string;
    revision: string;
    classification: "reliable" | "flaky" | "unknown";
    attempts: number;
    historicalFailureRate?: number;
    evidence: readonly EvidenceReference[];
}
```

`TestObligationPolicy` 从确定性的影响类型生成最小测试义务：公开 API 或 DTO 变更需要契约/兼容性义务，异常分支需要
错误路径义务，权限变更需要授权义务，数据库迁移需要持久化与兼容性义务，工作流变更需要事件和安全策略 fixture。
该策略不能以“本次未修改测试文件”作为缺失测试证据。

`TestInventoryPort` 发现受支持测试框架中的测试资产、标签、fixture、测试结果与覆盖报告。首期接入 Vitest/Jest、
JUnit 与 JaCoCo/LCOV 适配器。测试与影响的关联可以来自静态调用/契约引用、测试标签、覆盖报告或受控执行结果，
并必须记录关联方法。测试发现失败、语言不受支持、覆盖数据不可比或受安全策略禁止运行时，状态必须是
`not-assessable`，而不是“缺少测试”。

`demonstrated` 的最低条件是：已成功发现测试，存在适用测试或覆盖证据，该证据关联当前影响路径，且当前提交上的
相关测试结果为 `passed`。测试失败、跳过或不可运行不能作为覆盖证明。
`partial` 表示仅覆盖部分义务；`not-demonstrated` 表示测试发现成功但没有可证明覆盖该义务的证据。AI 可以把后二者
解释成可执行的测试建议，但除非项目明确将确定性测试义务设为门禁，否则不得阻断 CI。

测试文件存在、测试名称相似或单纯的行覆盖率都不足以单独证明义务已完成。`TestCoverageEvidence` 必须记录测试 ID、
框架、执行提交、结果、覆盖种类及其与影响路径的关联方式；契约、授权、异常分支、集成和迁移义务需要对应类型的
验证证据，而不是被普通行覆盖率替代。

`TestReliabilityPolicy` 决定测试结果能否用于回归或覆盖结论。它必须记录重跑上限、测试隔离/隔离名单、历史失败率、
最小观察窗口和人工确认规则。被标记为 `flaky` 或 `unknown` 的测试可以保留在报告中，但不能单独形成
`verified regression` 或 `demonstrated` 覆盖；重跑结果和可靠性分类必须附在证据中，不能静默吞掉失败。

### 8.5 基线比较与可验证回归

```ts
interface RevisionComparison {
    baseRevision: string;
    headRevision: string;
    environmentDigest: string;
    selectionPolicyDigest: string;
    baseDependencyDigest: string;
    headDependencyDigest: string;
    baseTestSelectionDigest: string;
    headTestSelectionDigest: string;
    baseResult: "passed" | "failed" | "unavailable";
    headResult: "passed" | "failed" | "unavailable";
}
```

`RevisionBehaviorComparator` 只在受控隔离环境中比较基线与当前提交。只有基线通过、当前提交失败、执行环境和
测试选择策略一致，且失败测试与 `ChangeImpact` 具有可解释路径时，才能生成 `verified regression`。依赖摘要和实际
测试选择允许随提交变化：它们是变更事实，不能因锁文件或新增测试变化而让比较失效。基线已失败时为
`pre-existing-or-unknown`；环境不一致、测试不可运行或影响无法关联时为 `not-assessable`/`unverified-impact`。

测试影响分析使用由固定选择策略生成的“base 受影响测试 + head 受影响测试 + 新增测试 + 最近失败测试”的并集。
索引遇到无法理解的语言、动态依赖或文件类型时，应安全降级为全量关键测试或显式 `not-assessable`，不得静默遗漏。
周期性全量回归测试用于校验选择策略，防止长期遗漏影响路径。

宿主 CLI 不执行不可信 PR 的脚本。测试、覆盖与基线比较由无 Secret 的受控沙箱完成，并将提交范围、执行环境、
依赖、测试选择和结果摘要绑定为签名证明；评论/汇总任务只验证证明，不能执行仓库命令。

### 8.6 供 AI 使用的影响包

`ImpactPackage` 是远程模型的唯一影响分析输入，包含安全 DiffChunk、已验证影响路径、契约差异、业务能力映射、
测试义务、基线比较、影响覆盖状态以及所有 `unknown`/`not-assessable` 原因。AI 只能：

1. 解释已知影响路径和潜在回归条件；
2. 建议如何满足未证明的测试义务；
3. 指出需要人工确认的业务规则、动态依赖或外部消费者；
4. 说明证据限制。

AI 不得把 `unaddressed`、`not-demonstrated` 或 `unknown` 直接表述为已确认缺陷、实际生产回归或绝对缺失测试。

## 9. 验证、抑制与展示策略

验证器按顺序执行：安全检查、文件分类、证据锚定、事实存在性、规则/AST/编译/测试核验、矛盾检查和去重。
验证器按 `AssertionPolicy` 选择的最低方法执行，不能因模型自报高置信度或多个非独立来源而跳过要求。

以下情况必须抑制或降级：

- 模型将 `documentation-example` 作为执行配置；
- 断言所需外部事实不可用；
- 结论与已确认事实矛盾；
- 断言引用的 chunk、行范围或摘要不一致；
- 同一指纹已被人工标记为误报，且修订版本仍匹配。

摘要评论固定分区，避免可信度混淆：

```md
## 已验证问题
<!-- 仅 verified，可能参与门禁 -->

## 人工审查建议
<!-- advisory / corroborated，绝不阻断 -->

## 扫描范围与限制
<!-- 分析器状态、未验证外部事实、被过滤数量 -->
```

`unverifiable` 默认只在“扫描范围与限制”中按计数和原因码出现；配置可选择在详细报告中显示，
但不得推送为高优先级通知。

## 10. 质量评测与人工反馈闭环

每次运行保存脱敏的：分析器/模型/提示词版本、规则版本、事实类型、验证状态、发现指纹、耗时、预算和最终投递状态。
人工可对每项发现标记：`accepted`、`false-positive`、`not-applicable`、`duplicate` 或 `deferred`。

反馈是有权限维护者对某次发现的处置记录，不是自动化真相来源。反馈入口必须绑定仓库、发现指纹、规则/契约版本、
提交范围与操作者权限，并设置保留期和可撤销状态。`accepted` 是有用性代理指标，不等同于正确率；正确率和召回率
只从经人工复核的标注样本集估计。

构建版本化回归评测集，至少覆盖：

- 真缺陷、无缺陷改动、已知误报和敏感内容场景；
- 多语言代码与 GitHub/GitLab/CodeUp/Jenkins/Azure 自动化配置；
- 可执行工作流与文档示例的同形 YAML；
- 外部事实可用、不可用和冲突三种状态；
- 大型 diff、截断上下文、fork PR 和权限边界。
- 已验证回归、历史失败、环境不一致、测试抖动和无法关联的失败；
- 已有测试覆盖、部分覆盖、未证明覆盖与测试发现不可用；
- API、事件、权限、迁移和业务能力映射的影响路径。

发布新提示词、模型或规则前，应在评测集和 shadow mode 上比较：已验证发现精确率、AI 建议接受率、
误报率、重复率、降级率、评论噪声率、成本与耗时。未达到既定基线不得扩大到默认配置。

低接受率不能直接关闭安全、密钥、权限边界或确定性规则。任何自动调整最多将 AI 建议降为 `advisory`，且须满足
版本化最小样本量、时间窗口、跨维护者覆盖和类别分层要求；默认能力的禁用、规则阈值变化或全局抑制必须经人工审批。
基线、样本量和阈值在启用 shadow mode 前写入评测清单，不能在结果产生后追溯修改。

## 11. 分期实施与验收

### 阶段 A：可信度语义收敛

- 增加 `ReviewFact`、`ReviewAssertion`、`unverifiable` 与 `corroborated`；
- 增加受控 `AssertionPolicy` 注册表；AI 输出 schema 不接受验证方法、严重级别、门禁资格或最终处置字段；
- 将现有 `grounded` 明确映射为“证据已锚定 + 人工审查建议”，同步更新军规、总架构、README 与评论协议；
- 增加断言—证据一致性和矛盾抑制测试。

验收：AI 无法将仅引用 diff 的文本作为 `verified` 输出，也无法选择其验证方法或门禁资格；CI 门禁行为不被扩大。

### 阶段 B：文件分类与通用自动化 IR

- 实现 `RepositoryFileClassifier`、`AutomationParserAdapter`、`AutomationDefinition`；
- GitHub Actions 为第一个解析器；实现平台无关的最小权限、信任边界和不可变引用规则，以及平台语义事实；
- 在不执行仓库配置的前提下实现解析资源限制、循环 include 检测、分类依据与 `reachability`；
- 为文档示例与真实工作流建立镜像 fixture。

验收：同一 YAML 在 `docs/**` 中不触发运行时工作流规则，在真实平台入口中才触发；领域规则不含 `github` 分支。

### 阶段 C：变更影响与测试义务

- 增加 `ChangeImpact`、`ImpactPath`、`TestObligation`、`ImpactCoverage` 和 `RevisionComparison`；
- 实现 TypeScript/Java 语义影响索引、跨 base/head 的 `SymbolIdentity`、带证据的 `ImpactEdge`、版本化契约差异、兼容策略、带快照的外部消费者目录和受控业务能力目录解析；
- 接入 Vitest/Jest、JUnit 的测试资产发现，先输出测试义务与影响覆盖状态，不加入门禁。

验收：每条测试建议都有变更锚点、带证据的影响路径和测试义务；影响闭环分别报告实现、兼容性和验证状态；
测试发现不可用时输出 `not-assessable`，不声称缺少测试；过期的业务/消费者映射不参与门禁。

### 阶段 D：可信外部事实、上下文包与回归比较

- 接入受信任端点、无凭据、受资源限制的可选 `ExternalFactResolver`，未能解析时明确降级；
- 引入由 `ImpactPackage` 驱动的 `ReviewContextPackage` 与输入预算报告；
- 接入受控沙箱的 base/head 测试比较、覆盖报告、`TestReliabilityPolicy` 和签名证明；
- 更新 AI 断言协议与验证器，并以不可执行数据边界隔离所有模型输入。

验收：模型无法在没有解析结果时声明外部 SHA、版本或镜像事实；只有可比基线通过、当前失败、测试可靠且关联影响路径的结果才可标记为回归；失败或跳过测试不能证明覆盖。

### 阶段 E：评测与运营治理

- 建立反馈端口、离线评测集、shadow mode 和质量指标；
- 将提示词、规则和模型版本纳入运行记录；
- 为低接受率类别设置受样本量、类别和人工审批约束的降级流程。

验收：每项默认启用的 AI 能力都有可追踪质量指标；模型升级有可比较的回归报告。

## 12. 测试要求

- 每个平台解析器具有解析失败、未知字段、模板引用、执行入口和文档误识别的契约测试；
- 首个适配器阶段为每条通用 IR 规则提供真实平台 fixture 与规范化 IR fixture；第二个平台适配器启用后，
  新增或修改的通用规则必须至少使用两个真实平台 fixture 验证，防止规则重新耦合 GitHub 语义；
- 外部事实适配器测试成功、超时、无权限、来源不可信和缓存失效；
- AI 契约测试必须覆盖事实缺失、矛盾事实、上下文截断、错误证据 ID、提示注入与敏感信息回显；
- 解析器测试必须覆盖资源上限、循环 include、YAML alias 与未知可达性；
- 影响索引测试必须覆盖调用/实现/契约/配置/事件关系、动态依赖 `unknown` 和本次变更锚定；
- 测试义务测试必须覆盖“未改测试但已覆盖”“改了测试但仍未覆盖”“测试发现不可用”与不同义务类型；
- 基线比较测试必须覆盖基线失败、环境不一致、锁文件变化、新增测试、测试抖动、无关失败和已验证回归；
- 影响路径测试必须验证每条边的起点、终点、关系、证据和完整性，不能只检查节点集合；
- 契约兼容性测试必须覆盖已知/未知外部消费者、策略版本、破坏性变更和双版本兼容证据；
- 符号身份测试必须覆盖重命名、移动、重载、实现替换、多个候选和无法匹配时的 `unknown`；
- 测试可靠性测试必须覆盖重跑通过、重复失败、历史 flaky、隔离名单和可靠性不足时不得升级回归/覆盖；
- 端到端测试验证：已验证发现可门禁，AI-only 建议不可门禁，文档示例不可触发执行配置风险。

## 13. 迁移与兼容性

现有 CLI、GitHub Action、DeepSeek 配置、摘要评论标识和三位退出码继续有效。新增字段先以向后兼容方式写入
运行记录和评论；旧 `grounded` 状态在读取时映射为 `anchored + advisory`。在阶段 B 通过真实仓库 fixture 验证前，
自动化配置审查只以观察模式输出，不加入门禁。

变更影响、测试义务和影响覆盖在阶段 C 先以观察模式输出；基线比较与覆盖证明未满足前，不得使用其 AI 建议作为
门禁依据。新增的业务能力目录是可选增强：未配置时保留技术影响分析并显式报告业务上下文不可用。

任何新平台、新语言、新模型或新外部事实源，必须通过本设计的适配器、证据、验证和评测边界接入，
不得以提示词中的平台特例替代实现。

## 14. 外部实践基准

- [GitHub Actions Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) 将完整提交 SHA
  固定视为不可变引用的安全基线；本设计要求先由解析器与可信事实源确认执行上下文，再进行规则判定。
- [GitHub CodeQL custom queries](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/custom-queries)
  体现了以可定位、可解释的结构化静态分析结果承载确定性发现的做法；本项目通过事实与验证证据兼容该类工具。
- [GitHub CodeQL data-flow paths](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-vs-code/explore-data-flow)
  展示了用可定位路径解释语义关系的方式；本设计将其限定为影响图的确定性证据，而不是模型推断。
- [Microsoft Test Impact Analysis](https://learn.microsoft.com/azure/devops/pipelines/test/test-impact-analysis)
  采用受影响测试选择、无法理解时安全回退和周期性全量测试；对应本设计的测试选择与回归比较策略。
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) 将依赖固定、危险工作流等作为可验证的供应链检查项；
  对应本设计中面向 `AutomationDefinition` 的通用规则。
- [NIST AI RMF Measure](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) 强调持续测量、记录不确定性和依据
  部署反馈更新控制措施；对应本设计的评测集、shadow mode 与人工反馈闭环。
- [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
  将代码注释、提交信息和文档列为间接提示注入来源；对应本设计的模型输入分级与不可执行数据边界。
