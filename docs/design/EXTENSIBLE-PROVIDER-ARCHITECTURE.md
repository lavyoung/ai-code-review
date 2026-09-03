# 可扩展 Provider 架构调整方案

> 本文将 `ai-code-review` 从“首期适配器直接分支”的实现方式，调整为“显式注册的 Provider 适配架构”。目标是让
> GitHub、CodeUp、GitLab、Gitee、Bitbucket 以及 DeepSeek、其他 AI 提供方在不修改领域模型和统一评审用例的前提下接入。它不引入运行时插件市场、远程插件下载或微服务拆分。

## 1. 背景与问题

当前领域评审模型、统一分析器编排、验证和门禁策略已基本平台无关；但接口层、配置和 bootstrap 仍存在首期实现的固定分支：

- CLI 以 `if/else` 判断 GitHub PR、CodeUp MR 与本地手动评审；
- 平台上下文错误类型限定为 `github | codeup`；
- AI 配置和 bootstrap 固定为 DeepSeek；
- 评论配置固定为 `comments.github`、`comments.codeup`；
- 历史设计文档存在固定 Provider 枚举。

如果继续沿用该模式，新增 GitHub Push、CodeUp Push 或第二个 AI 提供方都会扩大条件分支，并使平台/供应商差异进入应用编排。该问题必须在
Push 实施前解决。

## 2. 架构决策

### 2.1 采用显式注册表，不采用插件市场

注册表由 `bootstrap` 在编译期装配经过审核的适配器：

```text
CLI
  -> ReviewTriggerAdapterRegistry
  -> ReviewRangeUseCase
  -> ReviewAnalyzerRegistry
  -> DeliveryAdapterRegistry
```

这保留 TypeScript 类型检查、依赖审查、可预测启动行为与最小权限，避免运行时下载插件、执行第三方代码或引入插件版本兼容治理。

### 2.2 平台与 AI 是适配器身份，不是领域枚举

领域层不定义 `github`、`codeup`、`deepseek` 等联合类型。适配器使用稳定的字符串 ID，例如 `github`、`codeup`、`deepseek`
，并由注册表验证是否已注册。未知 ID 必须得到可预测错误，而不是静默降级。

### 2.3 一个通用评审范围用例

PR、MR、Push 与手动运行的区别仅在于如何获得已验证的提交范围和交付目标。完成范围解析后，所有模式必须调用同一
`ReviewRangeUseCase`：

```text
Trigger Adapter
  -> ReviewInvocation / ReviewSkip
  -> ReviewRangeUseCase
  -> analyzers -> verification -> policy
  -> delivery ports -> process status
```

## 3. 核心契约

### 3.1 触发适配器

`ReviewTriggerAdapter` 位于应用端口，具体实现位于平台基础设施层。环境变量、事件文件、平台 API 和平台 Token 只能由适配器读取。

```ts
interface ReviewInvocation {
    providerId: string;
    event: ReviewEventType;
    repository: {
        id: string;
        displayName: string;
    };
    range: {
        baseRef: string;
        headRef: string;
        comparison: "two-dot" | "three-dot";
    };
    reportTarget: string;
    summaryComment?: ReviewSummaryComment;
}

interface ReviewSkip {
    reason: "initial-push" | "branch-deleted" | "tag-push";
}

interface ReviewTriggerAdapter {
    readonly providerId: string;
    readonly event: ReviewEventType;

    validateConfiguration(): void;

    resolve(request: ReviewTriggerRequest): Promise<ReviewTriggerResolution>;
}
```

`ReviewInvocation` 不包含平台 payload、Token、Webhook、原始 API 响应或本地路径。它只表达应用层需要的提交范围、显示信息和可选交付目标。

### 3.2 注册表

```ts
interface ReviewTriggerAdapterRegistry {
    resolve(providerId: string, event: ReviewEventType): ReviewTriggerAdapter | undefined;

    supported(): readonly { providerId: string; event: ReviewEventType }[];
}
```

首批注册组合：

| Provider | Event           | Adapter                                          |
|----------|-----------------|--------------------------------------------------|
| `local`  | `manual`        | `LocalManualReviewTriggerAdapter`                |
| `github` | `pull-request`  | `GitHubPullRequestReviewTriggerAdapter`          |
| `codeup` | `merge-request` | `CodeUpMergeRequestReviewTriggerAdapter`         |
| `github` | `push`          | `GitHubPushTriggerAdapter`，在 Push Issue 中实施 |

新增 GitLab、Gitee、Bitbucket 或 CodeUp Push 时，只新增并注册对应 Adapter；`ReviewRangeUseCase`、领域策略与分析器编排不应修改。

### 3.3 通用范围用例

当前 `runManualReviewUseCase` 与 `runPullRequestReviewUseCase` 先作为兼容包装保留，再逐步委托给：

```ts
runReviewRangeUseCase(invocation, dependencies)
```

该用例调用 `DiffProvider`，使用 `invocation.range.comparison` 获取已提交变更，再委托既有 `reviewCodeChangeUseCase`。Push 固定
two-dot；PR/MR 固定 three-dot；手动评审保持既有 `target...HEAD` 语义。

## 4. AI Provider 架构

### 4.1 适配器工厂

`AiReviewPort` 与统一结构化评审契约保持不变。新增 `AiProviderFactory`，由 bootstrap 按已解析的 AI Provider ID 创建
`ReviewAnalyzer`：

```ts
interface AiProviderFactory {
    readonly providerId: string;

    create(configuration: AiProviderRuntimeConfiguration): ReviewAnalyzer;
}
```

DeepSeek 是第一个注册项，不再是应用配置模型中的唯一联合类型。新 AI 提供方必须实现同一结构化结果契约、脱敏输入约束、错误类别与重试语义。

### 4.2 配置迁移

新的规范配置：

```yaml
ai:
  default_provider: deepseek
  providers:
    deepseek:
      model: deepseek-v4-flash
      timeout_ms: 30000
```

配置文件不保存密钥。Provider 专属密钥继续仅由其基础设施适配器从环境变量或 CI Secret 读取，例如 `DEEPSEEK_API_KEY`。通用选择项使用：

```text
REVIEW_AI_PROVIDER
REVIEW_AI_MODEL
REVIEW_AI_TIMEOUT_MS
```

兼容策略：当前 `ai.provider`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_MS` 在一个小版本周期内作为 DeepSeek
的兼容输入保留；新旧值同时提供且冲突时，以新的通用配置优先，并输出不含敏感信息的迁移警告。移除旧入口只能在下一个主版本进行。

## 5. 评论、通知与交付

`ReviewCommentPort` 与 `NotifierPort` 保持平台无关。平台适配器负责根据 `ReviewInvocation.commentTarget` 创建相应端口。

配置从固定嵌套结构逐步演进为：

```yaml
delivery:
  comments:
    github:
      enabled: true
      fail_on_error: false
    codeup:
      enabled: true
      fail_on_error: false
```

配置解析允许已注册 Provider 的键；未知键必须以 `102` 失败，避免拼写错误被忽略。评论识别标志继续使用
`{providerId}:{repositoryId}:{changeId}`，保证跨平台唯一性和更新幂等。

GitHub Composite Action 仍是 GitHub 专属适配器，不需要伪装为通用 Action；GitLab CI、CodeUp Flow 等平台通过其 CI 文件调用同一
CLI 合约。

## 6. 依赖方向与目录

```text
domain/
  review/                         # 不包含 Provider 名称
application/
  review/ports/
    review-trigger-adapter.ts
    ai-provider-factory.ts
    review-comment-port.ts
  review/use-cases/
    run-review-range-use-case.ts
infrastructure/
  scm/github/
    github-pull-request-trigger-adapter.ts
    github-push-trigger-adapter.ts
  scm/codeup/
    codeup-merge-request-trigger-adapter.ts
  ai/deepseek/
    deepseek-ai-provider-factory.ts
interfaces/cli/
  commands/review-command.ts      # 仅解析参数并查询注册表
bootstrap/
  create-review-runtime.ts        # 唯一注册与装配边界
```

`bootstrap` 可以引用每个具体适配器，但不得承载平台事件解析或业务决策。随着注册项增多，可按 `createScmAdapters`、
`createAiProviders`、`createDeliveryAdapters` 拆分工厂函数。

## 7. 分阶段迁移

### 阶段 A：契约与注册表（已完成）

1. 引入 `ReviewInvocation`、`ReviewSkip`、`ReviewTriggerAdapter` 与 Registry。
2. 将 `ReviewPlatformContextError` 改为接收任意 Provider ID 与事件类型。
3. 为现有 local manual、GitHub PR、CodeUp MR 编写契约测试。
4. 保持全部现有 CLI 命令、退出码和评论协议行为不变。

### 阶段 B：统一范围编排（已完成）

1. 实现 `runReviewRangeUseCase`。
2. 将现有 manual / PR / MR 用例变为兼容委托包装。
3. 验证 two-dot 与 three-dot 比较语义完全不回归。

### 阶段 C：AI 与交付配置迁移

1. 引入 `AiProviderFactory`；DeepSeek 作为首个注册项。
2. 增加新规范配置和旧配置兼容解析测试。
3. 引入 Delivery Adapter Registry，迁移 GitHub / CodeUp 评论端口创建。
4. 旧配置在文档中标记为兼容路径，但不立即删除。

### 阶段 D：GitHub Push 首个适配器

在 [Push 自动审查架构](./PUSH-REVIEW-ARCHITECTURE.md) 约束下，新增 GitHub Push resolver 与工作流。它只能依赖阶段 A/B
的通用契约，禁止在 CLI 再次加入 GitHub 专属分支。

### 阶段 E：后续平台

以 CodeUp Push 作为第二个验证案例；GitLab、Gitee、Bitbucket 按相同契约接入。每个新平台必须证明无需修改领域模型、范围用例、评审策略或
AI Provider 工厂。

## 8. 验收标准

- [x] Domain 与 `runReviewRangeUseCase` 中不存在 GitHub、CodeUp、DeepSeek 等具体 Provider 分支。
- [x] CLI 通过 Trigger Registry 路由，未知组合稳定返回 `101` 并列出已注册组合。
- [x] 已有 local manual、GitHub PR、CodeUp MR 的范围、评论协议和退出码由兼容用例与 Trigger Adapter 契约测试保护。
- [ ] DeepSeek 迁移后仍可通过旧环境变量工作；新配置优先级正确。
- [ ] AI / 平台 / 评论 Provider 的未知配置稳定返回 `102`。
- [ ] GitHub Push 作为首个新增平台事件，不修改领域策略或统一范围用例。
- [ ] 外部 Fork、密钥、脱敏和最小权限约束不回归。
- [ ] 所有适配器都通过同一组契约测试；构建、单测、CLI 集成测试和工作流验收通过。

## 9. 非目标

- 不实现动态插件安装、第三方插件执行或网络加载；
- 不引入微服务、消息队列或多租户控制台；
- 不在本次迁移中新增 GitLab/Gitee/Bitbucket 功能；
- 不改变 AI 发现必须经证据验证才能触发质量门禁的军规；
- 不自动修改 Git 提交、创建机器人修复提交或强推分支。
