# 平台无关的 Push 自动审查架构

> 本设计遵循[项目军规：统一 AI 代码质量审查](./PROJECT_CHARTER.md)。Push 是 `ai-code-review`
> 的第二种触发方式，而不是独立产品：它复用同一套变更模型、确定性证据、AI 评审、策略判定和可观测性边界。首个落地适配器是 GitHub
> Actions；CodeUp、GitLab、Gitee、Bitbucket 等平台必须复用同一 Push 用例，而不是复制评审核心。

## 1. 目标、范围与非目标

### 1.1 目标

当受控 Git 分支发生平台 `push` 事件时，系统应当：

1. 仅审查本次已提交的精确变更范围；
2. 在该次推送的 `after` 提交上产生对应平台的可追踪审查结果；
3. 以统一流水线汇聚 Java / TypeScript AST、SARIF、密钥扫描、沙箱测试等确定性证据和 DeepSeek 的结构化评审；
4. 按既有策略决定质量门禁与企业微信通知；
5. 让开发者依据结果自行修复并创建新提交，不改写 Git 历史。

### 1.2 首期范围

| 项目     | 设计决策                                               |
|----------|--------------------------------------------------------|
| 核心能力 | 平台无关；首期通过 GitHub Actions 的 `push` 事件接入   |
| 审查范围 | `beforeSha..afterSha`，Git two-dot 比较                |
| 产品入口 | `ai-code-review review --provider github --event push` |
| 审查结果 | GitHub Actions Job Check、脱敏日志、可选企业微信通知   |
| 评审能力 | 复用现有统一评审流水线与结果协议                       |
| 阻断依据 | 仅可验证的确定性发现项可阻断；AI 建议默认仅供人工参考  |

### 1.3 明确不做

- 不扫描未提交工作区、全仓库历史或以 `HEAD^` 猜测范围；
- 不自动 `commit`、`amend`、`rebase`、`push --force`，也不创建机器人修复提交；
- 不为 Push 创建 PR 摘要评论、行级评论或 Issue；
- 不因 AI 的单独结论阻断分支；
- 不把 Push 设计为另一个名为 `java-codeql` 的产品或工作流入口。

## 2. 事件与 Git 比较范围契约

### 2.1 平台无关的 Push 上下文

应用层只接收以下只读模型，不读取平台环境变量、事件文件或 HTTP payload：

```ts
interface PushReviewContext {
    provider: string; // 已注册平台适配器的稳定标识，例如 github
    repository: { id: string; displayName: string };
    branch: string;
    beforeSha: string;
    afterSha: string;
}
```

每个平台的 Infrastructure 解析器必须完成平台 payload 到 `PushReviewContext` 的转换，并统一校验以下事实：

- 事件确为分支 Push，而不是 tag；
- 不是删除分支事件；
- `before` 和 `after` 均为完整、非全零的 40 位 SHA；
- 当前检出的 `HEAD` 与 `after` 一致（使用本地 Git diff 的平台）。

事件负载缺失、SHA 格式非法或 `HEAD` 不一致，均是平台上下文错误，使用退出码 `101`。解析器不应将平台 API、环境变量或事件文件泄漏到应用层。

### 2.2 GitHub 首个适配器

`GitHubActionsPushContextResolver` 从 GitHub Actions event payload 读取 `ref`、`before`、`after` 与仓库标识，并仅接受
`GITHUB_EVENT_NAME=push` 和 `refs/heads/*`。它输出 `PushReviewContext { provider: "github", ... }`；不改变通用用例、领域模型或
Git diff 端口。

### 2.3 精确范围

Push 的唯一比较方式为：

```text
git diff <beforeSha>..<afterSha>
```

它必须映射到现有 `DiffProvider.getRawCodeChange({ baseRef, headRef, comparison: "two-dot" })`。PR 仍使用
`target...source` 的 three-dot 语义；二者不可混用。

| 场景                                 | 行为                                              | 退出码 |
|--------------------------------------|---------------------------------------------------|--------|
| 常规分支推送                         | 审查 `before..after`                              | 按策略 |
| 首次推送（`before` 为全零 SHA）      | 成功跳过，记录 `initial-push`                     | 0      |
| 删除分支                             | 成功跳过，记录 `branch-deleted`                   | 0      |
| Tag 推送                             | 成功跳过，记录 `tag-push`                         | 0      |
| 本地没有 `before` 对象且无法安全获取 | 不猜测范围，失败                                  | 103    |
| 强推                                 | 仍按 payload 的 `before..after`；对象不可得即失败 | 103    |

“成功跳过”必须输出脱敏的机器可识别原因，不产生通知，也不以空 diff 伪装为完成审查。

### 2.4 Checkout 与对象可用性

工作流必须使用 `actions/checkout` 的完整历史（`fetch-depth: 0`），确保两端提交可被本地 Git 解析。实现可以在 checkout 后安全验证
`beforeSha` 对象存在，但不得用网络下载任意 payload 指向的对象，也不得用其他提交替代。

## 3. 分层设计与用例编排

### 3.1 新增组件边界

| 层                          | 组件                                              | 职责                                                  |
|-----------------------------|---------------------------------------------------|-------------------------------------------------------|
| Infrastructure / 平台适配器 | `resolve-*-push-context.ts`                       | 读取并校验平台 Push payload，返回 `PushReviewContext` |
| Application                 | `resolve-push-code-change.ts`                     | 通过 `DiffProvider` 用 two-dot 取得已提交变更         |
| Application                 | `run-push-review-use-case.ts`                     | 编排 Push 专属前置条件和统一评审用例                  |
| Application                 | 既有统一评审用例                                  | 分析、证据合并、AI 调用、策略、日志与通知             |
| Domain                      | 既有 `CodeChange`、`ReviewResult`、`ReviewPolicy` | 不感知 GitHub payload 或 CI 环境变量                  |
| Interfaces / CLI            | `review-command.ts`                               | 将 `<provider> + push` 路由到同一 Push 用例           |

### 3.2 用例流

```text
GitHub / CodeUp / GitLab / Gitee / Bitbucket push payload
  -> PlatformPushContextResolver (Infrastructure)
  -> PushReviewContext (Application input)
  -> resolvePushCodeChange(before, after, two-dot)
  -> ReviewCodeChangeUseCase (shared)
     -> deterministic analyzers / evidence
     -> DeepSeek structured review
     -> evidence reconciliation + ReviewPolicy
     -> redacted CI output + notification plan
  -> process exit status
```

Push 用例不得复制 PR 的评论逻辑。评论端口保持 PR/MR 摘要评论的专属能力；Push 的交付状态为 `not-applicable`，而非“评论失败”。

### 3.3 统一结果模型

`ReviewResult` 保持一次运行只有一个结果。每条发现项应继续携带来源与可信度，例如 `ai-suggestion`、`java-ast`、
`sarif-verified`。策略仅基于已定义的严重级别、可信等级和 `failOn` 判定，通知适配器不能自行决定是否阻断。

## 4. CLI、配置与退出码

### 4.1 CLI 合约

通用 CLI 合约为：

```bash
ai-code-review review --provider <provider> --event push
```

首期受支持组合是 `--provider github --event push`；其他平台在其 Context Resolver 与 CI 适配器完成后启用。事件范围完全由平台
payload 决定。CLI 不提供 `--before`、`--after` 覆盖参数，避免 CI 中将审查范围意外切换到任意提交。

| Provider                            | Event         | 变更来源             | 评论行为                              |
|-------------------------------------|---------------|----------------------|---------------------------------------|
| local                               | manual        | `target...HEAD`      | 无                                    |
| github                              | pull-request  | PR `target...source` | 更新摘要评论                          |
| github                              | push          | Push `before..after` | 无，使用 GitHub Actions Check（首期） |
| codeup / gitlab / gitee / bitbucket | push          | Push `before..after` | 后续平台适配器决定平台原生结果载体    |
| codeup                              | merge-request | MR 目标与源          | 更新摘要评论                          |

### 4.2 配置复用

不新增 Push 专属的重复配置层。既有 `failOn`、分析器开关、模型输入上限、输出语言、通知和脱敏策略仍按：CLI 参数 > 环境变量 >
配置文件 > 默认值 生效。分支范围应通过 GitHub workflow 的 `on.push.branches` 控制，而不是配置文件和工作流双重维护。

通知阈值执行既有产品规则：Push 默认仅处理 `high` 与 `critical`；PR/MR 默认 `medium` 及以上；无问题不通知。通知失败重试两次，最终结果写入脱敏日志；Push
没有摘要评论可追加时，只记录日志与运行结果。

### 4.3 退出码语义

| 退出码  | 含义                        | Push 的处理                  |
|---------|-----------------------------|------------------------------|
| 0       | 成功、无阻断，或合法跳过    | Check 成功                   |
| 100     | 质量门禁拒绝                | Check 失败，开发者新提交修复 |
| 101     | GitHub 事件/上下文不合法    | Check 失败                   |
| 102     | 配置错误                    | Check 失败                   |
| 103     | Git 比较范围/对象获取错误   | Check 失败                   |
| 104     | 确定性分析器执行错误        | 按既有运行策略处理           |
| 105     | 证据验证错误                | 按既有运行策略处理           |
| 110–119 | AI 调用或结构化响应错误类别 | 默认不阻断，除非显式配置     |

具体码的含义继续按“错误类别”划分，绝不为单个 AI 供应商分配编码。合法跳过不属于错误。

## 5. GitHub 首个工作流适配器

### 5.1 工作流定位

GitHub 仓库维护一个面向产品的 `.github/workflows/ai-code-review.yml`。它可以声明 PR 和 Push 两种触发器，并通过清晰的 job
保留最小权限边界。其他平台应保留等价的 CI 适配文件，但只能调用同一 CLI 合约：

```yaml
name: AI Code Review

on:
  pull_request:
    types: [ opened, synchronize, reopened ]
  push:
    branches: [ main, develop ]

jobs:
  review-fork:
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork
    # contents: read; no repository secrets and no write permission

  review-internal:
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false
    # contents: read, pull-requests: write, issues: write

  review-push:
    if: github.event_name == 'push'
    # contents: read
```

首期仅对受控集成分支启用 Push；实际分支名单由仓库治理确定。合并 PR 后触发一次 Push 是预期行为：它验证最终合并提交，不重复创建评论。

### 5.2 Composite Action 合约

`action.yml` 增加或确认 `event` 输入，取值 `pull-request` / `push`，默认 `pull-request`。Push job 调用：

```yaml
uses: lavyoung/ai-code-review@v0.1.1
with:
  event: push
```

Action 仅将该输入传递给 CLI；CLI 仍交叉校验真实 `GITHUB_EVENT_NAME`，不能由输入伪造上下文。复合动作运行时使用已发布、固定的
action ref；发布仓库自己的 PR 工作流也不得用 `uses: ./` 来审查不可信 PR 内容。

### 5.3 权限、并发与重复执行

- Push job 最小权限为 `contents: read`；不授予 `pull-requests: write`、`issues: write` 或 `security-events: write`
  ，除非某个已启用阶段明确需要；
- 若启用 CodeQL/SARIF 上传，应将上传能力拆到可信、权限更高且不接触外部 PR 内容的 job；
- Push 和 PR 使用不同 concurrency group，例如 `ai-code-review-push-${{ github.repository }}-${{ github.ref }}`；同一分支新推送取消旧
  Push 审查；
- PR group 以 PR 编号为键，避免 Push 取消正在运行的 PR 审查；
- 外部 Fork PR 仅运行无 Secret、无写权限的确定性阶段；同仓库 PR 才可以使用 DeepSeek 与摘要评论；
- 不在 job 中执行仓库可修改的脚本来获得凭据，也不把 secrets 传给不可信 fork 的代码路径。

## 6. 安全与隐私边界

1. 只读取 checkout 后的已提交对象；不读取工作区脏文件。
2. 调用模型前继续应用敏感路径过滤与内容脱敏；日志、Check 输出、企业微信消息不包含密钥、原始敏感路径或完整敏感 diff。
3. PR 与 Push 的信任模型独立：Push 只由受控分支触发；外部 Fork PR 不接收 Secret 或写权限，也不得通过平台特权事件
   checkout/执行 PR 头部脚本来绕过该限制。
4. 运行标识、范围 SHA、发现数量、脱敏错误类别可以记录；API Key、Token、Webhook、模型原始异常体不可记录。
5. 系统只提供“发现与建议”，没有自动修复提交能力，因此无法借由 Push 触发自循环。

## 7. 人机协作与输出约定

GitHub 首期的 Push 主输出是与 `afterSha` 绑定的 GitHub Check；其他平台应映射到其原生 CI Job、Commit Status 或 Pipeline
Result，但输出协议与退出码保持一致：

| 结果                       | Check                | 开发者动作                 |
|----------------------------|----------------------|----------------------------|
| 无阻断发现                 | 成功                 | 继续开发或人工查看建议     |
| AI 建议                    | 成功（默认）         | 人工确认后自行提交修复     |
| 已验证且达到门禁阈值的发现 | 失败（100）          | 修复后创建后续提交         |
| 平台/范围/配置错误         | 失败（101–103 等）   | 修复流水线或配置后重新运行 |
| 通知失败                   | 不改变主结果（默认） | 在脱敏日志中追踪           |

不使用“追加提交信息”或改写既有提交来传递问题。Git 提交信息是不可变历史说明；审查意见应留在 Check、日志、通知或 PR 摘要中。

## 8. 测试设计

| 层级           | 覆盖点                                                                                                                |
|----------------|-----------------------------------------------------------------------------------------------------------------------|
| 上下文解析单测 | 正常 push、tag、分支删除、全零 before、非法 SHA、HEAD 不一致                                                          |
| Git 适配器单测 | 明确验证调用 `two-dot` 与 `before/after`，不接受回退范围                                                              |
| 应用用例单测   | Push 不调用评论端口；复用统一策略与通知计划                                                                           |
| CLI 集成测试   | `github + push` 路由正确；非法组合得到 101                                                                            |
| 配置测试       | 既有优先级和 Push 默认通知阈值不回归                                                                                  |
| 工作流静态检查 | `event: push`、完整 checkout、最小权限、分离 concurrency group                                                        |
| 平台适配验收   | GitHub 首期覆盖普通 Push、连续 Push 取消旧任务、Java 改动、非 Java 改动、门禁失败、通知失败；后续平台复用同一契约用例 |

验收中应在真实 GitHub Actions 上确认 Check 显示在推送提交上，并核验日志没有泄露 secret。强推和历史不完整导致 `before`
不可用时，预期结果是清晰的 103，而不是错误评审。

## 9. 分阶段实施与发布

### 阶段 A：领域外上下文与本地验证（已完成）

实现 `PushReviewContext`、平台无关的 two-dot change resolver、Push use case 和 CLI 路由；先落地 GitHub resolver，并补齐契约单测与
Git 集成测试。此阶段不改变线上 workflow。

### 阶段 B：GitHub 工作流接入（待发布后启用）

在统一 `ai-code-review.yml` 中增加受控分支 GitHub Push job、完整 checkout、权限和并发设置；以不阻断模式观察真实
Check、耗时、空范围和通知行为。后续平台只新增 CI/context adapter，不复制用例。

### 阶段 C：质量证据观察

启用已准备好的 Java AST、TypeScript、SARIF、密钥扫描等阶段，持续记录证据覆盖和人工采纳情况。AI 建议仍不阻断。

### 阶段 D：渐进门禁

先仅将 `critical` 的可信确定性发现纳入门禁；在误报率、修复时效和人工复核稳定后，才评估是否扩大到 `high`
。每一次扩大必须独立评审，不能由模型质量主观判断替代。

## 10. 实施验收清单

- [x] GitHub Push Trigger Adapter 仅产出平台无关的 `ReviewInvocation` / `ReviewSkip`，并校验有效 `before/after` 与检出
  `HEAD`；
- [x] Diff 始终为 `before..after`，使用 two-dot 且无隐式回退；
- [x] 共享评审流水线与结果协议，没有复制 PR 逻辑；
- [x] Push 不调用 PR/MR 评论端口；
- [ ] 工作流使用完整 checkout、最小权限和事件隔离并发组（需在发布含 Push 合约的 Action 版本后启用）；
- [x] 日志、通知和模型输入复用现有脱敏策略；
- [x] 通知失败复用既有两次重试，默认不改变主审查结果；
- [x] 退出码与合法跳过原因可预测；GitHub Check 展示待真实工作流验收；
- [x] 单测与本地构建已通过；GitHub Actions 真实 Push 验收待发布后执行；
- [x] README 已说明 Push 的使用方式、边界和默认不自动修复行为；后续平台接入仅增加适配器文档。
