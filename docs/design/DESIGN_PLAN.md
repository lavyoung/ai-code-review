# ai-code-review 设计规划文档

## 1. 背景

团队在日常研发中会产生大量代码提交、分支合并和流水线构建。传统 Code Review 主要依赖人工完成，容易出现以下问题：

- 简单规范问题反复占用人工评审时间。
- 高风险改动在合并前暴露较晚。
- 不同仓库、不同平台的评审标准不一致。
- Push、Merge Request、手动检查等场景缺少统一的自动化评审入口。
- 评审结果无法及时同步到企业微信、钉钉、飞书等团队协作工具。

`ai-code-review` 的目标是在 CI/CD 流水线中提供一层 AI 自动评审能力，让团队在人工 Review 前先完成基础风险筛查和问题通知。

## 2. 项目目标

### 2.1 核心目标

- 支持在代码提交、合并请求、手动触发等场景中自动执行 AI Review。
- 支持阿里云 CodeUp，并预留 GitHub、GitLab 等平台扩展能力。
- 支持企业微信通知，并预留钉钉、飞书、邮件、通用 Webhook 等通知扩展能力。
- 支持 PR / MR 评论回写，将 AI Review 结果沉淀到代码托管平台的评审上下文中。
- 支持输出结构化评审结果，便于流水线判断是否通过。
- 支持按照严重级别控制是否通知、是否阻断流水线。

### 2.2 非目标

第一阶段不做以下能力：

- 不做 Web 管理后台。
- 不做复杂多租户权限体系。
- 不做插件市场分发。
- 不做完整代码质量平台。
- 不替代 SonarQube、Checkstyle、SpotBugs 等静态扫描工具。
- 不承诺 AI Review 结果完全准确，仍需保留人工判断。

## 3. 使用场景

### 3.1 Push 触发评审

开发者向远程分支提交代码后，流水线自动触发 AI Review。

适合场景：

- 个人分支自检。
- 主干提交保护。
- 高频提交中的快速风险提醒。

注意事项：

- Push 触发频率高，通知策略应更克制。
- 建议只在 `high` 或 `critical` 问题出现时发送企业微信通知。
- 普通问题可只输出到 CI 日志，避免消息刷屏。

### 3.2 Merge Request / Pull Request 触发评审

创建或更新合并请求时，自动评审源分支相对于目标分支的整体 diff。

适合场景：

- 合并前风险把关。
- 给人工 reviewer 提供预审摘要。
- 将 AI Review 结果回写为 MR / PR 评论。

注意事项：

- MR / PR 场景适合输出更完整的评审摘要。
- 第一阶段优先支持摘要评论，行级评论作为后续增强，避免过早绑定不同平台的行号模型。

### 3.3 手动触发评审

开发者或流水线手动执行评审命令。

适合场景：

- 本地调试。
- 临时检查某个分支。
- 接入新仓库前验证配置。

### 3.4 定时触发评审

按计划周期对指定分支或范围进行评审。

适合场景：

- 夜间批量检查。
- 长期分支风险巡检。
- 重点仓库定期质量巡检。

第一阶段仅预留模型，不优先实现。

## 4. 总体架构

```text
Trigger Adapter
      ↓
Event Resolver
      ↓
Diff Resolver
      ↓
Context Loader
      ↓
AI Reviewer
      ↓
Policy Engine
      ↓
Reporter / Notifier Fanout
```

整体设计采用 DDD 的分层思想，但第一阶段不做过度抽象。核心原则是：评审业务规则放在领域层，流水线、Git、CodeUp、GitHub、企业微信等外部细节放在基础设施层，应用层只负责编排一次评审用例。

```text
Interfaces Layer
  CLI / CI Entry / Webhook Entry
        ↓
Application Layer
  ReviewUseCase / NotifyUseCase / CommentUseCase
        ↓
Domain Layer
  ReviewEvent / CodeChange / ReviewResult / ReviewPolicy
        ↓
Infrastructure Layer
  Git / CodeUp / GitHub / GitLab / WeCom / DingTalk / Feishu / Email
```

### 4.1 Trigger Adapter

负责识别当前评审来源。

计划支持：

- `push`
- `merge_request`
- `pull_request`
- `manual`
- `schedule`

不同平台的环境变量、Webhook Payload、流水线参数不同，统一转换为内部事件模型。

### 4.2 Event Resolver

负责将外部平台事件转换为统一的 `ReviewEvent`。

事件中应包含：

- 事件类型。
- 代码平台。
- 仓库名称。
- 仓库地址。
- 源分支。
- 目标分支。
- 起始提交。
- 结束提交。
- 合并请求编号。
- 提交人。
- 触发人。

### 4.3 Diff Resolver

负责获取本次需要评审的代码变更。

计划支持：

- 本地 Git diff。
- Commit range diff。
- Branch compare diff。
- CodeUp API diff。
- GitHub API diff。
- GitLab API diff。

第一阶段优先使用本地 Git 命令获取 diff，降低平台 API 接入复杂度。

### 4.4 Context Loader

负责加载评审上下文。

可加载内容：

- 仓库级评审规则。
- 项目语言和技术栈信息。
- `AGENTS.md`、`README.md`、自定义规则文件。
- 变更文件的相关上下文片段。

第一阶段只加载必要规则和 diff，避免上下文过大。

### 4.5 AI Reviewer

负责调用 AI 模型完成代码评审，并输出结构化结果。

评审关注点：

- 明显逻辑错误。
- 空值风险。
- 并发风险。
- SQL / 性能风险。
- 安全风险。
- 异常处理问题。
- 破坏兼容性的行为变更。
- 测试缺失或验证不足。
- 项目规范违背。

AI 输出必须结构化，便于机器处理。

### 4.6 Policy Engine

负责根据评审结果决定后续动作。

策略包括：

- 哪些严重级别需要通知。
- 哪些严重级别需要阻断流水线。
- 哪些事件类型需要通知。
- 单次通知最多展示多少条问题。
- 无问题时是否发送通过通知。

### 4.7 Reporter / Notifier Fanout

负责将评审结果输出到多个目标。

计划支持：

- CI Log。
- 企业微信。
- 通用 Webhook。
- 钉钉。
- 飞书。
- Email。
- MR / PR 评论。

Fanout 模式允许一次评审结果同时发送到多个渠道。

### 4.8 Comment Publisher

负责将评审结果回写到代码托管平台。

计划支持：

- MR / PR 摘要评论。
- MR / PR 行级评论。
- 已存在评论的更新或折叠。
- 同一次评审的幂等识别。

第一阶段优先支持摘要评论，原因是不同平台对 diff position、line、old line、new line 的定义差异较大，直接做行级评论容易增加平台适配复杂度。

## 5. DDD 分层设计

### 5.1 领域层

领域层表达 AI Review 的核心业务概念，不依赖具体平台、HTTP、Git 命令或 CI 环境变量。

核心对象：

- `ReviewEvent`：一次评审触发事件。
- `CodeChange`：本次需要评审的代码变更。
- `ReviewRuleSet`：评审规则集合。
- `ReviewFinding`：单条评审问题。
- `ReviewResult`：一次评审结果。
- `ReviewPolicy`：通知、评论、阻断流水线等策略。
- `ReviewComment`：需要回写到 PR / MR 的评论内容。

领域服务：

- `ReviewPolicyEvaluator`：根据评审结果判断是否通知、是否评论、是否失败。
- `ReviewResultSummarizer`：将结构化问题汇总为摘要。
- `ReviewCommentPlanner`：根据平台能力和配置决定生成摘要评论还是行级评论。

领域层不直接调用 AI 模型。AI 调用属于应用服务编排的外部能力，通过端口接入。

### 5.2 应用层

应用层负责编排完整用例。

核心用例：

- `RunReviewUseCase`：执行一次完整评审。
- `PublishNotificationUseCase`：发布通知。
- `PublishReviewCommentUseCase`：发布 PR / MR 评论。

应用层流程：

```text
解析事件
  ↓
获取 diff
  ↓
加载规则和上下文
  ↓
调用 AI Review Port
  ↓
解析评审结果
  ↓
执行策略判断
  ↓
发布通知和评论
  ↓
返回流水线退出状态
```

### 5.3 端口层

端口定义领域和应用层需要的外部能力。

主要端口：

- `DiffProvider`：获取 diff。
- `RepositoryProvider`：获取仓库、分支、提交、MR / PR 元数据。
- `AiReviewPort`：调用 AI 完成评审。
- `NotifierPort`：发送企业微信、钉钉、飞书、邮件等通知。
- `ReviewCommentPort`：回写 PR / MR 评论。
- `ConfigPort`：读取配置。

端口只定义能力，不包含平台实现。

### 5.4 基础设施层

基础设施层实现具体平台适配。

平台适配：

- `LocalGitDiffProvider`
- `CodeUpRepositoryProvider`
- `CodeUpReviewCommentAdapter`
- `GitHubRepositoryProvider`
- `GitHubReviewCommentAdapter`
- `GitLabRepositoryProvider`
- `GitLabReviewCommentAdapter`

通知适配：

- `WeComNotifier`
- `DingTalkNotifier`
- `FeishuNotifier`
- `EmailNotifier`
- `GenericWebhookNotifier`

AI 适配：

- `DeepSeekReviewAdapter`
- 后续可扩展其他模型提供方。

### 5.5 接口层

接口层负责接收外部触发。

第一阶段接口：

- CLI 命令。
- CI 环境变量。

后续接口：

- Webhook Server。
- 配置检测命令。
- 本地调试命令。

## 6. 核心数据模型

### 6.1 ReviewEvent

```ts
type ReviewEventType =
  | 'push'
  | 'merge_request'
  | 'pull_request'
  | 'manual'
  | 'schedule';

type ProviderType =
  | 'local'
  | 'codeup'
  | 'github'
  | 'gitlab';

interface ReviewEvent {
  type: ReviewEventType;
  provider: ProviderType;
  repositoryName: string;
  repositoryUrl?: string;
  sourceBranch?: string;
  targetBranch?: string;
  beforeSha?: string;
  afterSha?: string;
  mergeRequestId?: string;
  pullRequestId?: string;
  author?: string;
  triggeredBy?: string;
}
```

### 6.2 CodeChange

```ts
interface CodeChange {
  baseSha?: string;
  headSha?: string;
  diff: string;
  files: ChangedFile[];
}

interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}
```

### 6.3 ReviewFinding

```ts
type Severity =
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

interface ReviewFinding {
  severity: Severity;
  title: string;
  file?: string;
  line?: number;
  category?: string;
  description: string;
  suggestion?: string;
  confidence?: number;
}
```

### 6.4 ReviewComment

```ts
interface ReviewComment {
  type: 'summary' | 'line';
  body: string;
  file?: string;
  line?: number;
  findingIds?: string[];
}
```

### 6.5 ReviewResult

```ts
interface ReviewResult {
  event: ReviewEvent;
  summary: string;
  findings: ReviewFinding[];
  highestSeverity: Severity;
  shouldFail: boolean;
  shouldNotify: boolean;
  shouldComment: boolean;
  comments: ReviewComment[];
  metadata?: Record<string, string>;
}
```

## 7. 配置设计

默认配置文件名：

```text
ai-code-review.yml
```

示例：

```yaml
review:
  mode: diff
  severity_threshold: medium
  fail_on:
    - critical
  max_findings: 20

events:
  push:
    enabled: true
    notify_on:
      - high
      - critical
  merge_request:
    enabled: true
    notify_on:
      - medium
      - high
      - critical
  manual:
    enabled: true

providers:
  codeup:
    enabled: true
    token: ${CODEUP_TOKEN}
  github:
    enabled: false
    token: ${GITHUB_TOKEN}
  gitlab:
    enabled: false
    token: ${GITLAB_TOKEN}

notifiers:
  wecom:
    enabled: true
    fail_on_error: false

comments:
  github:
    enabled: true
    fail_on_error: false
  codeup:
    enabled: true
    fail_on_error: false
```

## 8. PR / MR 评论设计

### 8.1 评论模式

第一阶段支持摘要评论：

- 将本次 AI Review 的结果汇总为一条 MR / PR 评论。
- 评论包含问题数量、最高严重级别、主要风险和建议。
- 评论中保留固定标识，便于后续重复运行时更新旧评论。

后续支持行级评论：

- 将具体问题评论到对应文件和行。
- 需要处理不同平台的 diff line position 差异。
- 需要处理过期评论、重复评论和 force push 后行号失效问题。

### 8.2 幂等策略

PR / MR 评论需要避免重复刷屏。

建议做法：

- 摘要评论中加入隐藏标识或固定标题。
- 再次运行时优先查找并更新上一条 AI Review 评论。
- 如果平台不支持更新，则追加新评论并在内容中说明运行时间和 commit。

### 8.3 评论内容

摘要评论建议包含：

- 评审状态。
- 本次评审 commit range。
- 问题统计。
- Top findings。
- 是否触发流水线失败。
- 完整日志或流水线链接。

### 8.4 平台适配顺序

优先级：

1. CodeUp MR 摘要评论。
2. GitHub PR 摘要评论。
3. GitLab MR 摘要评论。
4. 行级评论。

## 9. 企业微信通知设计

### 9.1 配置方式

企业微信机器人 Webhook 不写入仓库，统一通过环境变量注入。

```bash
WECOM_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
```

`WECOM_WEBHOOK_URL` 只能从环境变量或 CI Secret 注入，配置文件只保存 `notifiers.wecom.enabled` 与 `fail_on_error`。发送失败时会在首次请求后额外重试 2 次；默认不阻断流水线，最终投递状态仅以脱敏摘要写入 CI 日志和后续的 MR/PR 评论。

### 9.2 通知内容

通知应包含：

- 项目名称。
- 事件类型。
- 分支信息。
- 提交范围或 MR 编号。
- 问题总数。
- 最高严重级别。
- Top findings 摘要。
- 流水线链接或 MR 链接。

### 9.3 通知策略

建议默认策略：

- Push 事件：仅 `high`、`critical` 问题通知。
- MR / PR 事件：`medium` 及以上问题通知。
- Manual 事件：默认输出 CI Log，可配置是否通知。
- 无问题时：默认不通知，避免打扰。

## 10. CodeUp 支持规划

### 10.1 推荐接入方式

第一阶段优先支持 CodeUp + 云效 Flow。

```text
CodeUp 代码事件
    ↓
云效 Flow 触发流水线
    ↓
流水线拉取仓库代码
    ↓
执行 ai-code-review
    ↓
输出 CI 日志并发送企业微信通知
```

### 10.2 事件支持

计划支持：

- Push 事件。
- Merge Request 创建。
- Merge Request 更新。
- Merge Request 重新打开。

### 10.3 Diff 获取策略

优先级：

1. 流水线本地 Git diff。
2. CodeUp 环境变量提供的 commit range。
3. CodeUp API 获取 MR diff。

第一阶段优先实现前两种，CodeUp API 作为后续增强。

### 10.4 MR 评论策略

CodeUp 支持应优先完成 MR 摘要评论。

第一阶段策略：

- 在 MR 触发场景下生成一条 AI Review 摘要评论。
- 评论失败不应默认阻断流水线，但必须输出 CI Log。
- 是否因为评论失败而失败流水线由配置控制。

后续增强：

- 支持查询历史评论并更新已有 AI Review 评论。
- 支持行级评论。
- 支持将高危问题作为 MR 阻断依据。

## 11. CLI 设计

计划提供统一命令入口：

```bash
ai-code-review review --event push
ai-code-review review --event merge-request
ai-code-review review --event manual
```

常用参数：

```bash
ai-code-review review \
  --provider codeup \
  --event merge-request \
  --target main \
  --source feature/demo \
  --config ai-code-review.yml
```

本地调试：

```bash
ai-code-review review \
  --provider local \
  --event manual \
  --target main
```

## 12. 模块规划

```text
src/
  cli/
    index.ts
  config/
    load-config.ts
    resolve-env.ts
  events/
    review-event.test.ts
    resolve-event.ts
  providers/
    local-git.ts
    codeup.ts
    github.ts
    gitlab.ts
  diff/
    diff-resolver.ts
    git-diff.ts
  context/
    context-loader.ts
    rules-loader.ts
  reviewer/
    ai-reviewer.ts
    prompt-builder.ts
    result-parser.ts
  policy/
    policy-engine.ts
  comments/
    comment-planner.ts
    review-comment.ts
  notifiers/
    notifier.ts
    ci-log.ts
    wecom.ts
    generic-webhook.ts
  reporters/
    markdown-renderer.ts
    json-renderer.ts
```

DDD 风格目录可进一步演进为：

```text
src/
  domain/
    review/
      review-event.test.ts
      code-change.ts
      review-finding.ts
      review-result.ts
      review-policy.ts
      review-comment.ts
      review-policy-evaluator.ts
      review-comment-planner.ts
  application/
    run-review-use-case.ts
    publish-notification-use-case.ts
    publish-review-comment-use-case.ts
    ports/
      diff-provider.ts
      ai-review-port.ts
      notifier-port.ts
      review-comment-port.ts
      repository-provider.ts
  infrastructure/
    git/
    codeup/
    github/
    gitlab/
    notifiers/
    ai/
    config/
  interfaces/
    cli/
    ci/
```

第一阶段建议直接采用 DDD 分层目录，避免后续平台扩展时再大规模搬迁。

## 13. MVP 实施计划

### 阶段一：基础闭环

目标：

- 能在本地或 CI 中运行。
- 能读取 Git diff。
- 能调用 AI 生成结构化评审结果。
- 能输出 CI Log。
- 能发送企业微信通知。
- 能在 MR / PR 场景生成摘要评论内容。

验收标准：

- 执行 `ai-code-review review --event manual --provider local --target main` 能完成评审。
- 有问题时能在控制台输出 Markdown 摘要。
- 达到通知阈值时企业微信能收到消息。
- 达到失败阈值时进程以非 0 状态退出。
- MR / PR 场景下能生成可回写的摘要评论文本。

### 阶段二：CodeUp / Flow 接入

目标：

- 支持云效 Flow 中运行。
- 支持 CodeUp Push 和 Merge Request 场景。
- 能根据环境变量自动识别事件上下文。
- 支持 CodeUp MR 摘要评论回写。

验收标准：

- CodeUp Push 触发时能评审本次提交范围。
- CodeUp Merge Request 触发时能评审源分支到目标分支的 diff。
- 企业微信通知中包含 CodeUp 仓库、分支和 MR 信息。
- CodeUp Merge Request 页面能看到 AI Review 摘要评论。

### 阶段三：多通知渠道

目标：

- 支持通用 Webhook。
- 支持钉钉和飞书。
- 通知渠道可组合启用。

验收标准：

- 同一次评审结果可以同时输出到 CI Log 和多个通知渠道。
- 单个通知渠道失败不影响其他渠道发送。
- 通知失败可在 CI Log 中明确展示。

### 阶段四：平台扩展

目标：

- 支持 GitHub Actions。
- 支持 GitLab CI。
- 支持 GitHub PR 和 GitLab MR 摘要评论回写。
- 预留 MR / PR 行级评论能力。

验收标准：

- GitHub Pull Request 事件可完成 diff 评审。
- GitLab Merge Request 事件可完成 diff 评审。
- 平台适配逻辑不影响 CodeUp 使用。
- GitHub PR 和 GitLab MR 能看到 AI Review 摘要评论。

## 14. 风险与约束

### 14.1 AI 误报与漏报

AI Review 结果不能作为唯一质量门禁。高危阻断策略应谨慎开启，建议先观察一段时间。

### 14.2 Token 和上下文限制

大型 MR 可能产生超长 diff，需要支持 diff 裁剪、文件过滤和分批评审。

### 14.3 通知噪音

Push 触发频率高，如果所有问题都通知，会影响团队体验。默认应采用高严重级别通知策略。

### 14.4 平台环境差异

CodeUp、GitHub、GitLab 的事件变量和 diff 获取方式不同。平台差异必须限制在 Provider 层，不能扩散到核心评审流程。

### 14.5 PR / MR 评论差异

不同平台的评论 API 差异较大，尤其是行级评论。第一阶段应先做摘要评论，避免让行号定位、diff position、重复评论清理拖慢 MVP。

### 14.6 密钥安全

企业微信 Webhook、AI API Key、平台 Token 必须通过环境变量或 CI Secret 注入，不允许写入仓库。

## 15. 架构决策

### 15.1 名称与技术基线

- 项目、CLI 命令和默认配置文件统一使用 `ai-code-review`。
- 第一阶段采用 Node.js / TypeScript 实现 CLI，首期 AI 提供方为 DeepSeek，默认模型为 `deepseek-v4-flash`。
- DeepSeek 凭据必须通过环境变量或 CI Secret 注入，不得写入配置仓库、日志或评论。

### 15.2 配置与变更范围

- 配置优先级固定为：CLI 参数 > 环境变量 > `ai-code-review.yml` > 内置默认值。
- 评审文本语言通过 `--output-language`、`REVIEW_OUTPUT_LANGUAGE` 或 `ai.output_language` 配置，必须使用 BCP 47 语言标签，默认 `en`；它只影响摘要、标题、说明、分类和建议文本，固定 JSON 字段名、严重级别与 Markdown 评论协议保持不变。
- 只评审已提交的 Git 变更：Push 使用 `beforeSha..afterSha`，MR/PR 使用 `target...source`，手动评审使用 `target...HEAD`。
- 未提交工作区不纳入评审范围；发现未提交改动时，仅输出不包含敏感文件路径的提示。

### 15.3 安全与投递失败

- 敏感文件不进入模型上下文，敏感文件路径和内容不得出现在 CI 日志、评论或错误信息中。
- 日志、评论和错误信息必须对 Token、API Key、Authorization、URL 查询参数等敏感值脱敏。
- 通知失败时必须重试 2 次；最终的脱敏失败状态必须写入 CI 日志和 PR/MR 摘要评论。
- 通知与评论失败默认不阻断流水线；仅在配置明确要求时才阻断。

### 15.4 评论协议

PR/MR 摘要评论必须使用固定的、可识别且可更新的协议：

```md
<!-- ai-code-review:review-id={provider}:{repository}:{change-id} -->

## AI Code Review

- 状态：通过 / 质量门禁未通过 / 执行失败
- 评审范围：`baseSha...headSha`
- 最高严重级别：high
- 问题统计：critical 0 / high 1 / medium 2
- 流水线：{url}

### Findings
1. `[high]` 标题 — 文件与行号（可定位时）

### Delivery Status
- CI 日志：成功
- 企业微信：失败（已重试 2 次）
```

发布评论时必须先按隐藏标识查找已有评论，找到后更新，找不到时才创建。

当前实现已固化该协议：`reviewId` 由 `{provider}:{repository}:{change-id}` 组成，评论端口仅提供 `upsertSummary`。CodeUp 的查询、创建和更新 API 将在平台适配器中实现，不能泄漏到应用层。

CodeUp 适配器通过其合并请求评论列表查找该标识；命中后更新 `commentBizId`，未命中时以 `GLOBAL_COMMENT` 创建。创建全局评论必须显式传入当前 MR 的 `patchSetBizId`，Token 仅由 CI Secret 或环境变量注入。

GitHub 适配器使用 PR 的 Issue Comment 时间线接口，而不是行级 Review Comment 接口：查询 `/issues/{pull_number}/comments`，命中标识后 `PATCH /issues/comments/{comment_id}`，否则 `POST /issues/{pull_number}/comments`。它支持分页和 GitHub Enterprise 自定义 API 地址，Token 仅由 CI Secret 或环境变量注入。

GitHub PR 摘要评论开关为 `comments.github.enabled`，可使用 `comments.github.fail_on_error` 明确要求评论失败时阻断流水线（退出码 `120`）。`GITHUB_TOKEN` 只能通过环境变量或 CI Secret 注入；评论在企业微信投递完成后发布，因此可记录企业微信的最终脱敏投递状态。

GitHub Actions 的 PR 评审使用事件文件中的 `pull_request.base.sha...pull_request.head.sha`，不使用默认的合并引用。工作流须完整检出历史：

```yaml
on:
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
      ref: ${{ github.event.pull_request.head.sha }}
  - run: npx ai-code-review review --provider github --event pull-request
    env:
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

例如，以下三种方式都可将最终评审文本设为中文，优先级依次递减：

```bash
ai-code-review review --provider local --event manual --target main --output-language zh-CN
```

```yaml
env:
  REVIEW_OUTPUT_LANGUAGE: zh-CN
```

```yaml
ai:
  output_language: zh-CN
```

CodeUp Flow 的官方内置变量提供当前代码源的分支和最新提交，但不提供 MR 编号、目标提交或版本 ID。CodeUp MR 模式通过 API 自动定位唯一的打开 MR，再从其版本列表获取源/目标 SHA 与 `patchSetBizId`，命令为 `ai-code-review review --provider codeup --event merge-request`：

| 变量 | 是否必填 | 含义 |
| --- | --- | --- |
| `CI_COMMIT_REF_NAME` | Flow 内置 | 当前代码源分支，用于定位候选 MR |
| `CI_COMMIT_SHA` | Flow 内置 | 当前代码源最新提交，必须匹配 MR 源版本 |
| `AICR_CODEUP_REPOSITORY_ID` | 是 | 流水线静态配置的 CodeUp 仓库 ID 或完整路径 |
| `AICR_CODEUP_API_BASE_URL` | 是 | CodeUp OpenAPI 服务域名 |
| `AICR_CODEUP_ORGANIZATION_ID` | 中心版 | CodeUp 组织 ID |
| `CODEUP_TOKEN` | 是 | 私密变量；用于查询 MR/版本并发布评论，绝不写入仓库 |

若同一源分支匹配多个打开 MR，或 `CI_COMMIT_SHA` 不等于该 MR 源版本，工具将以事件上下文错误退出，不会猜测目标分支或评审范围。

### 15.5 分层与职责

- 采用 DDD 分层：领域层表达评审模型和策略；应用层编排用例；端口定义外部能力；基础设施层实现 Git、DeepSeek、通知和评论适配器。
- `AiReviewPort` 只负责生成结构化评审结果；策略层只负责决定质量门禁、通知和评论；通知与评论适配器只负责投递；应用层负责汇总结果和退出码。

### 15.6 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 评审完成，未触发质量门禁 |
| `100` | 评审完成，但发现项触发 `fail_on` 质量门禁 |
| `101` | CLI 参数或事件不合法 |
| `102` | 配置非法、配置文件不可用或缺少凭据 |
| `103` | Git 仓库、提交范围或 diff 获取失败 |
| `110` | AI 请求或服务端请求失败 |
| `111` | AI 服务拒绝认证或授权 |
| `112` | AI 服务限流 |
| `113` | AI 请求超时 |
| `114` | AI 响应不完整 |
| `115` | AI 响应或输出不是合法 JSON |
| `116` | AI 响应或输出不符合结构化 Schema |
| `117` | AI 内容被服务端过滤 |
| `118` | AI 输入或上下文超过服务限制 |
| `119` | 未分类的 AI 执行失败 |
| `120` | 评论发布失败且配置要求其阻断流水线 |
| `121` | 通知发布失败且配置要求其阻断流水线 |

## 16. 技术选型建议

第一阶段建议使用 Node.js / TypeScript 实现。

原因：

- 适合编写 CLI 工具。
- CI 环境安装成本低。
- HTTP、Webhook、JSON、YAML 处理方便。
- 后续发布 npm 包更自然。
- GitHub Actions、CodeUp Flow、GitLab CI 都容易接入。

后续如需企业内部强类型服务化部署，可再考虑提供 Java / Spring Boot 服务端，但不建议作为第一阶段 MVP 起点。

## 17. 当前推荐路线

推荐按以下顺序推进：

1. 创建基础 CLI 工程。
2. 实现本地 Git diff 获取。
3. 实现 AI Review 调用与结构化结果解析。
4. 实现 CI Log 输出。
5. 实现企业微信通知。
6. 实现摘要评论生成。
7. 接入 CodeUp / 云效 Flow。
8. 实现 CodeUp MR 摘要评论回写。
9. 增加通用 Webhook。
10. 扩展钉钉、飞书、GitHub、GitLab。

这条路线可以最快验证核心价值，同时保留足够清晰的扩展边界。
