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

