# ai-code-review

AI-powered code review workflow for push, pull request, merge request, and CI pipelines.

## 项目目的

`ai-code-review` 旨在提供一个可接入多种代码托管平台和流水线环境的 AI 代码评审工具，帮助团队在代码提交、合并请求、手动触发或定时任务中自动发现潜在问题，并通过企业内部通知渠道及时提醒相关人员。

项目重点不是替代人工 Code Review，而是在人工评审前完成第一轮自动化检查，提前暴露明显的逻辑风险、规范问题、潜在缺陷、安全隐患和可维护性问题，减少低价值重复评审成本。

## 设计目标

- 支持多种触发方式：`push`、`pull request`、`merge request`、手动触发和后续定时触发。
- 支持多种代码平台：优先支持阿里云 CodeUp，后续扩展 GitHub、GitLab 等平台。
- 支持多种通知方式：优先支持企业微信，后续扩展钉钉、飞书、邮件、通用 Webhook 等渠道。
- 支持 CI/CD 集成：可作为云效 Flow、GitHub Actions、GitLab CI 或其他流水线中的一个评审步骤运行。
- 保持平台解耦：核心评审能力不绑定具体代码托管平台，平台差异通过 Provider 适配。
- 保持通知解耦：评审结果统一输出，通知渠道通过 Notifier 扩展。

## 核心流程

```text
代码事件触发
    ↓
识别事件类型和代码平台
    ↓
获取本次变更 diff
    ↓
调用 AI 执行代码评审
    ↓
生成结构化评审结果
    ↓
根据策略决定是否通知或阻断流水线
    ↓
发送企业微信 / Webhook / CI 日志等通知
```

## 首期范围

第一阶段优先实现最小可用闭环：

- 本地 Git diff 评审。
- Push 事件评审。
- Merge Request 事件评审。
- 企业微信 Markdown 通知。
- CI 日志输出。
- 按严重级别决定是否让流水线失败。

暂不优先实现：

- Web 控制台。
- 复杂规则引擎。
- 多租户管理。
- 行级评论回写。
- 插件市场发布。

## 预期使用方式

```bash
ai-code-review review --event push
ai-code-review review --event merge-request
ai-code-review review --event manual
```

企业微信通知通过环境变量配置：

```bash
WECOM_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
```

## 评审输出语言

摘要、发现项标题、说明、分类和建议使用 BCP 47 语言标签配置；固定 JSON 字段名、严重级别与 Markdown 评论协议不受影响。配置优先级为：CLI 参数 > 环境变量 > `ai-code-review.yml` > 默认值 `en`。

常用标签：`zh-CN`（简体中文）、`zh-TW`（繁体中文）、`en`（英语）、`ja`（日语）、`ko`（韩语）。

临时指定语言：

```bash
ai-code-review review --provider local --event manual --target main --output-language zh-CN
```

在 `ai-code-review.yml` 中长期配置：

```yaml
ai:
  output_language: zh-CN
```

GitHub Actions 中使用环境变量配置，并将密钥保存在仓库 Secret：

```yaml
- name: Review pull request
  run: npx tsx src/interfaces/cli/index.ts review --provider github --event pull-request
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    GITHUB_COMMENT_ENABLED: "true"
    GITHUB_TOKEN: ${{ github.token }}
    REVIEW_OUTPUT_LANGUAGE: zh-CN
```

## 分析器执行预算

评审执行器会隔离建议性分析器失败，并为所有分析器实施总时限、并发数和 AI 请求数上限。配置优先级仍为 CLI 参数、环境变量、`ai-code-review.yml`、默认值；当前可通过环境变量或配置文件设置执行预算：

```yaml
execution:
  total_timeout_ms: 300000
  max_analyzer_concurrency: 3
  max_ai_request_count: 8
```

对应环境变量为 `REVIEW_TOTAL_ANALYZER_TIMEOUT_MS`、`REVIEW_MAX_ANALYZER_CONCURRENCY` 和 `REVIEW_MAX_AI_REQUEST_COUNT`。超出 AI 请求预算或必需分析器不可用时，流水线会以非零退出码结束；建议性分析器失败只会进入脱敏运行摘要。

临时覆盖时可使用：

```bash
ai-code-review review --provider local --event manual --target main \
  --total-analyzer-timeout-ms 300000 \
  --max-analyzer-concurrency 3 \
  --max-ai-request-count 8
```

## TypeScript 确定性检查

DeepSeek 默认启用以兼容现有工作流。若只需要确定性检查，可在任一配置来源中关闭它；关闭后不再要求 `DEEPSEEK_API_KEY`，但必须启用至少一个其他分析器：

```yaml
analyzers:
  deepseek:
    enabled: false
  typescript:
    enabled: true
```

等效环境变量为 `DEEPSEEK_ANALYZER_ENABLED=false`，Composite Action 输入为 `deepseek-enabled: "false"`。

TypeScript 分析器在当前检出的提交上运行 `tsc --noEmit`，但只将能定位到本次新增 diff 行的诊断发布为发现项。它默认关闭；启用后，其已锚定诊断会标记为 `verified`，可按既有 `fail_on` 配置触发质量门禁。DeepSeek 发现仍为 `grounded`，不会单独阻断流水线。

长期配置：

```yaml
analyzers:
  typescript:
    enabled: true
    timeout_ms: 120000
```

也可使用环境变量 `TYPESCRIPT_ANALYZER_ENABLED=true`、`TYPESCRIPT_ANALYZER_TIMEOUT_MS=120000`，或临时指定：

```bash
ai-code-review review --provider local --event manual --target main --typescript-enabled true
```

启用它的仓库必须提供可用的 `tsconfig.json`；配置不可读取或 TypeScript 无法生成文件诊断时，该必需分析器将以退出码 `104` 失败，避免错误地将检查失效视为“没有问题”。

## SARIF 确定性检查

已生成 SARIF 2.1.0 报告的工具（如 CodeQL、Semgrep 或 ESLint 的 SARIF 输出）可通过本地文件接入。报告中的结果同样只在其位置对应本次新增 diff 行时才发布，并会标记为 `verified`：

```yaml
analyzers:
  sarif:
    enabled: true
    report_path: reports/review.sarif
```

也可使用 `SARIF_ANALYZER_ENABLED=true`、`SARIF_REPORT_PATH=reports/review.sarif`，或 `--sarif-enabled true --sarif-report reports/review.sarif`。启用时报告必须在评审命令之前生成；缺失或不符合 SARIF 2.1.0 的报告会使必需分析器以退出码 `104` 失败。

## 在其他 GitHub 仓库中使用

本项目提供 GitHub Composite Action。调用方必须先 checkout PR 的完整 Git 历史，并为工作流授予最小必要权限：

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, reopened, synchronize]

concurrency:
  group: ai-code-review-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: lavyoung/ai-code-review@<trusted-commit-sha>
        with:
          output-language: zh-CN
          comment-enabled: "true"
          typescript-enabled: "true"
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

将 `<trusted-commit-sha>` 替换为已审核的完整提交 SHA。发布不可变版本标签后也可以使用标签引用；完整 SHA 更适合生产环境。调用方在仓库 Secret 中配置 `DEEPSEEK_API_KEY`，`GITHUB_TOKEN` 由 Action 自动使用。

建议保留上面的 `concurrency` 配置：同一 PR 新提交会取消旧评审。Action 发布评论前还会校验 PR 当前 `head SHA`；若运行已过期，会显示为 `skipped`，不会覆盖新版本的摘要评论。

若本仓库为私有仓库，还需在 `ai-code-review` 仓库的 **Settings → Actions → General → Access** 中允许同一用户或组织下的私有仓库访问。外部仓库协作者可查看运行日志，因此不要在日志、评论或模型输入中输出密钥。

若工作流已在前一步生成 SARIF 报告，可将其作为本地输入交给 Action：

```yaml
      - uses: lavyoung/ai-code-review@<trusted-commit-sha>
        with:
          sarif-enabled: "true"
          sarif-report: reports/review.sarif
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

报告必须由此前步骤在当前工作区生成；Action 不会上传报告，也不会输出其中未映射到本次变更的路径、内容或结果。

## 作为 npm CLI 使用

发布后，包名为 `@lavyoung/ai-code-review`，发布 Registry 固定为 GitHub Packages。使用该包的项目先在 `.npmrc` 中配置 scope：

```ini
@lavyoung:registry=https://npm.pkg.github.com
```

本地安装 GitHub Packages 时，使用具有 `read:packages` 权限的 GitHub Personal Access Token（classic）登录：

```bash
npm login --scope=@lavyoung --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --save-dev @lavyoung/ai-code-review@0.1.0
```

安装后可在本地、CodeUp Flow 或 GitLab CI 中统一调用：

```bash
npx ai-code-review review --provider local --event manual --target main
```

在 CI 中，将 Registry 凭据保存为 Secret，并通过 `NODE_AUTH_TOKEN` 注入；不要将 Token 写入 `.npmrc` 或日志。

## 配置示例

```yaml
review:
  mode: diff
  severity_threshold: medium

events:
  push:
    enabled: true
  merge_request:
    enabled: true
  manual:
    enabled: true

notifiers:
  wecom:
    enabled: true
    webhook_url: ${WECOM_WEBHOOK_URL}
    notify_on:
      - high
      - critical
  generic_webhook:
    enabled: false
    url: ${REVIEW_WEBHOOK_URL}
  ci_log:
    enabled: true
```

## 平台支持计划

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Local Git | Planned | 用于本地调试和通用 CI 场景 |
| CodeUp | Planned | 优先支持云效 CodeUp / Flow |
| GitHub | Planned | 后续支持 GitHub Actions 和 Pull Request |
| GitLab | Planned | 后续支持 GitLab CI 和 Merge Request |

## 通知支持计划

| 通知渠道 | 状态 | 说明 |
| --- | --- | --- |
| 企业微信 | Planned | 第一阶段优先支持 |
| CI Log | Planned | 第一阶段优先支持 |
| 通用 Webhook | Planned | 用于对接内部系统 |
| 钉钉 | Planned | 后续扩展 |
| 飞书 | Planned | 后续扩展 |
| Email | Planned | 后续扩展 |

## 安全说明

- 不应将企业微信 Webhook、AI API Key、CodeUp Token 等敏感信息提交到仓库。
- 所有密钥应通过 CI/CD Secret、环境变量或密钥管理系统注入。
- 对接 CodeUp Webhook 时应校验请求来源和 Secret Token。

## 项目定位

`ai-code-review` 是一个面向工程团队的 AI Review 自动化工具。它更关注流水线集成、评审结果分发和多平台适配，而不是提供单一平台专用机器人。

