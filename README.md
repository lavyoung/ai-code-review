# ai-code-review

面向 Git 提交差异的 AI 代码评审 CLI 与 GitHub Composite Action。它只评审明确的已提交范围，生成可更新的摘要评论、脱敏 CI
日志和机器可处理的结构化结果；它不替代人工 Code Review。

项目的核心原则是：以基础确定性分析提供证据，由 AI 综合审查改动影响、潜在缺陷、边界与设计风险，并为人工 reviewer
汇总成一份统一结果。完整约束见[项目军规](docs/design/PROJECT_CHARTER.md)。

## 你会得到什么

- DeepSeek 语义评审，以及可选的 TypeScript、TypeScript AST、Java AST、SARIF、受控测试结果和高置信度密钥扫描。
- 三类清晰的结果：可阻断的已验证缺陷、供人工判断的 AI 建议、以及安全抑制的候选项。
- GitHub Pull Request 与 CodeUp Merge Request 的可更新摘要评论；企业微信通知和 CI 日志。
- 不记录完整 diff、密钥、敏感文件路径或敏感文件内容。

## 当前支持范围

| 场景                                     | 状态                | 说明                                                                    |
|------------------------------------------|---------------------|-------------------------------------------------------------------------|
| 本地 Git 手动评审                        | 支持                | 比较 `target...HEAD`，只包含已提交变更。                                |
| GitHub Actions Pull Request              | 支持                | 同仓库 PR 提供 AI 摘要评论；外部 Fork PR 仅运行无 Secret 的确定性审查。 |
| CodeUp Flow Merge Request                | 支持                | 通过 CodeUp API 定位当前 MR 和版本，支持摘要评论。                      |
| GitHub Actions Push                      | Action / CLI 已支持 | 严格审查 `before..after`；发布包含该能力的 Action 版本后再启用工作流。  |
| GitLab、CodeUp Push、定时任务            | 未实现              | CLI 会拒绝未实现的执行模式。                                            |
| 行级评论、通用 Webhook、钉钉、飞书、邮件 | 未实现              | 当前仅提供摘要评论、企业微信和 CI 日志。                                |

Push 评审采用平台无关的用例设计，首期将接入 GitHub Actions；后续 CodeUp、GitLab、Gitee、Bitbucket 等平台只需增加事件与 CI
适配器。设计见 [Push 自动审查架构](docs/design/PUSH-REVIEW-ARCHITECTURE.md)。

## 快速开始

前提：Node.js 22+、Git，以及可访问的目标提交。默认启用 DeepSeek，因此需要通过环境变量注入 `DEEPSEEK_API_KEY`。

安装已发布的 CLI 包后，评审当前分支相对 `main` 的已提交改动：

```bash
npx ai-code-review review --provider local --event manual --target main
```

在本仓库开发时使用：

```bash
npm run dev -- review --provider local --event manual --target main
```

若只运行确定性分析器，可关闭 DeepSeek 并至少启用一个其他分析器：

```bash
npx ai-code-review review --provider local --event manual --target main \
  --deepseek-enabled false \
  --typescript-ast-enabled true
```

## 配置

配置优先级固定为： **CLI 参数 > 环境变量 > `ai-code-review.yml` > 内置默认值**。未显式指定时，缺少默认配置文件不会报错；使用
`--config <path>` 时，该文件必须存在且符合格式。

以下是可直接使用的完整示例。密钥、Token、Webhook 和签名密钥只能放在环境变量或 CI Secret 中，不能写入 YAML：

```yaml
review:
  severity_threshold: medium
  fail_on: [ critical ]

ai:
  provider: deepseek
  enabled: true
  model: deepseek-v4-flash
  output_language: zh-CN
  timeout_ms: 30000

execution:
  total_timeout_ms: 300000
  max_analyzer_concurrency: 3
  max_ai_request_count: 8
  max_model_input_chars: 60000

analyzers:
  # `deepseek.enabled` 是兼容旧版本的入口；新配置使用 ai.enabled。
  typescript:
    enabled: false
    timeout_ms: 120000
  typescript_ast:
    enabled: false
  java_ast:
    enabled: false
  secret_scan:
    enabled: false
  sarif:
    enabled: false
    report_path: reports/review.sarif
    # Optional: only a report with this sidecar and a matching public key can gate CI.
    attestation_path: reports/review.sarif.attestation.json
  sandbox_tests:
    enabled: false
    report_path: artifacts/sandbox-test-result.json

notifiers:
  wecom:
    enabled: false
    fail_on_error: false

delivery:
  comments:
    github:
      enabled: false
      fail_on_error: false
    codeup:
      enabled: false
      fail_on_error: false

# 兼容旧版本；新配置请使用 delivery.comments。
comments:
  github:
    enabled: false
    fail_on_error: false
  codeup:
    enabled: false
    fail_on_error: false

recording:
  local_path: .ai-code-review/runs.jsonl
  quality_store:
    enabled: false
    endpoint_url: https://quality.example.com/api/v1/review-events
```

配置文件采用严格校验：不支持的字段会导致配置错误。`ai.provider` 与 `delivery.comments` 的 Provider 必须在当前版本已注册，
否则 CLI 以退出码 `102` 拒绝执行。上例中的 `report_path` 仅在对应分析器启用时必填；
`quality_store.endpoint_url` 仅在组织质量存储启用时必填。

### 常用环境变量

| 用途                 | 环境变量                                                                                                                                                                                                                             |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| AI Provider          | `REVIEW_AI_PROVIDER`、`REVIEW_AI_ENABLED`、`REVIEW_AI_MODEL`、`REVIEW_AI_TIMEOUT_MS`、`REVIEW_OUTPUT_LANGUAGE`；DeepSeek 兼容变量：`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_MS`、`DEEPSEEK_ANALYZER_ENABLED`          |
| 质量门禁             | `REVIEW_SEVERITY_THRESHOLD`、`REVIEW_FAIL_ON`                                                                                                                                                                                        |
| 执行预算             | `REVIEW_TOTAL_ANALYZER_TIMEOUT_MS`、`REVIEW_MAX_ANALYZER_CONCURRENCY`、`REVIEW_MAX_AI_REQUEST_COUNT`、`REVIEW_MAX_MODEL_INPUT_CHARS`                                                                                                 |
| TypeScript / Java    | `TYPESCRIPT_ANALYZER_ENABLED`、`TYPESCRIPT_ANALYZER_TIMEOUT_MS`、`TYPESCRIPT_AST_ANALYZER_ENABLED`、`JAVA_AST_ANALYZER_ENABLED`                                                                                                      |
| 其他分析器           | `SARIF_ANALYZER_ENABLED`、`SARIF_REPORT_PATH`、`SARIF_ATTESTATION_PATH`、`SARIF_VERIFICATION_PUBLIC_KEY`、`SECRET_SCAN_ANALYZER_ENABLED`、`SANDBOX_TEST_ANALYZER_ENABLED`、`SANDBOX_TEST_REPORT_PATH`、`SANDBOX_TEST_SIGNING_SECRET` |
| GitHub / CodeUp 评论 | `GITHUB_COMMENT_ENABLED`、`GITHUB_COMMENT_FAIL_ON_ERROR`、`GITHUB_TOKEN`、`CODEUP_COMMENT_ENABLED`、`CODEUP_COMMENT_FAIL_ON_ERROR`、`CODEUP_TOKEN`                                                                                   |
| 企业微信             | `WECOM_ENABLED`、`WECOM_FAIL_ON_ERROR`、`WECOM_WEBHOOK_URL`                                                                                                                                                                          |
| 质量记录             | `REVIEW_RUN_RECORD_PATH`、`QUALITY_STORE_ENABLED`、`QUALITY_STORE_ENDPOINT_URL`、`QUALITY_STORE_SIGNING_SECRET`                                                                                                                      |

所有布尔环境变量只接受 `true` 或 `false`。`REVIEW_FAIL_ON` 使用逗号分隔，例如 `critical,high`。评审文本的语言使用 BCP 47
标签，如 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`；固定 JSON 字段、严重级别和 Markdown 协议不随语言改变。

## 分析器与质量门禁

| 分析器         | 默认值 | 结论类型                             | 说明                                                                                                             |
|----------------|--------|--------------------------------------|------------------------------------------------------------------------------------------------------------------|
| DeepSeek       | 开启   | `anchored`（显示为 `advisory`）      | 已锚定本次 diff 的 AI 建议，仅供人工评审，不阻断流水线。                                                         |
| TypeScript     | 关闭   | `verified`                           | 只输出能可靠定位到新增 diff 行的 `tsc` 诊断。                                                                    |
| TypeScript AST | 关闭   | `verified`                           | 当前规则可靠识别新增 TypeScript 行中的 `eval(...)`。                                                             |
| Java AST       | 关闭   | `anchored`（显示为 `advisory`）      | 只解析新增 Java 行，不执行 Maven 或 Gradle；当前识别直接的 `Runtime.getRuntime().exec(...)` 调用，必须人工确认。 |
| GitHub Actions 自动化 | 开启 | `anchored`（显示为 `advisory`） | 只读取本次变更的 `.github/workflows/*.yml` 或 `.yaml` 在已提交 `HEAD` 中的内容；识别可变外部引用和不可信触发器与写权限组合，不执行工作流或脚本。 |
| SARIF          | 关闭   | 默认 `anchored`（显示为 `advisory`）；经证明后 `verified` | 仅采纳 SARIF 2.1.0 报告中定位到新增行的结果；没有有效证明时不可触发门禁。                                        |
| 密钥扫描       | 关闭   | `verified`                           | 只扫描新增行中的高置信度凭据，不输出凭据或敏感路径。                                                             |
| 受控测试结果   | 关闭   | `verified`                           | 仅接受签名有效、提交一致、定位到新增行的外部沙箱结果。                                                           |

只有 `verified` 发现可以根据 `review.fail_on` 触发质量门禁；`anchored` 仅表示证据已锚定，并以 `advisory` 人工建议展示，绝不会单独阻断流水线。历史 JSONL 记录中的 `grounded` 会兼容读取为 `anchored`。所有分析器共享总时限、并发数、AI
请求数和模型输入大小预算。DeepSeek 对网络、限流和超时错误最多额外重试两次；认证、JSON、Schema、内容过滤与上下文限制错误不会重试。

### GitHub Actions 自动化观察

GitHub Actions 自动化分析器不需要额外配置。它只在本次提交修改 `.github/workflows/*.yml` 或 `.yaml` 时，通过 Git
读取当前 `HEAD` 的工作流 YAML；不会读取未提交工作区，也不会执行 YAML、表达式、脚本、Action 或容器。解析受文件大小、
YAML 别名和嵌套深度限制。当前发现仅用于人工评审，永远不会阻断流水线。
同仓库复用工作流会在受限深度和数量内作为上下文读取；循环、无法读取或不适用的本地引用只记录为未解析状态，
不会将未改动的被引用工作流作为本次发现位置。

### 改动影响上下文

每次评审会从已提交 diff 的新增 TypeScript/Java 静态 `import` 与 CommonJS `require` 提取安全的影响关系，构建后仅将
锚点、目标标识与明确限制传给 AI；原始关联文件正文不会传出。动态 import、反射、未支持语言或索引失败都会明确标记为
`unknown`，不代表“没有影响”，也不能单独生成已确认缺陷、缺失测试或质量门禁。

### Java 语法检查

启用 `java_ast` 后，固定版本的 Java 解析器只在本地解析已提交 diff 的新增 `.java` 行；它不读取未提交工作区、不启动 JDK，也不执行
Maven、Gradle 或仓库脚本：

```yaml
analyzers:
  java_ast:
    enabled: true
```

也可使用 `JAVA_AST_ANALYZER_ENABLED=true` 或 `--java-ast-enabled true`。Java AST 的结果是已锚定的
advisory，不能直接触发门禁；需要语义、字节码或安全数据流证据时，可由 PMD、SpotBugs、CodeQL 等工具生成 SARIF 并导入。 GitHub
Actions 中以无 Secret 的 CodeQL 扫描 Java
并导入建议结果，可参考[Java CodeQL 与 SARIF 导入指南](docs/guides/java-codeql.md)。

### SARIF 信任边界

普通 SARIF 是 **可定位的外部建议**：报告可能来自任意工具或 PR 产物，因此默认以 `anchored`（`advisory`）显示，不会阻断流水线。若需要将某个
受控工具的结果作为门禁，必须同时提供 `SARIF_ATTESTATION_PATH` 与 `SARIF_VERIFICATION_PUBLIC_KEY`。证明将报告原始内容的
SHA-256 和完整 Git `HEAD` 绑定，并由 Ed25519 私钥签名；任何内容、提交或签名不匹配都会让必需的 SARIF 分析失败，不能静默升级。

私钥 `SARIF_SIGNING_PRIVATE_KEY` 只能放在隔离的可信分析任务中，评审任务只需要公钥 `SARIF_VERIFICATION_PUBLIC_KEY`。两者都是
Base64 编码的 DER：私钥为 PKCS#8，公钥为 SPKI。可用 Node.js 22+ 生成一对密钥，并立即将私钥保存到 CI Secret：

```bash
node --input-type=module -e "import {generateKeyPairSync} from 'node:crypto'; const k=generateKeyPairSync('ed25519'); console.log('SARIF_SIGNING_PRIVATE_KEY='+k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')); console.log('SARIF_VERIFICATION_PUBLIC_KEY='+k.publicKey.export({format:'der',type:'spki'}).toString('base64'))"
```

可信任务在 **不执行来自 PR 的脚本、且私钥未暴露给不可信任务**的前提下，生成 SARIF 后执行：

```bash
SARIF_SIGNING_PRIVATE_KEY=<ci-secret> \
  ai-code-review attest-sarif \
  --report reports/java.sarif \
  --output reports/java.sarif.attestation.json
```

之后的评审任务配置报告、证明与公钥：

```bash
SARIF_ANALYZER_ENABLED=true
SARIF_REPORT_PATH=reports/java.sarif
SARIF_ATTESTATION_PATH=reports/java.sarif.attestation.json
SARIF_VERIFICATION_PUBLIC_KEY=<public-key>
```

签名只证明报告由持有私钥的任务产出，不会自动证明 PMD、SpotBugs 或 CodeQL 的规则配置正确。不要在会 checkout 或执行外部 Fork
PR 代码的同一任务中注入私钥；这会破坏该信任边界。

评审输出固定分为：

- **Confirmed findings**：可由确定性来源验证的缺陷。
- **AI suggestions for review**：需要人工判断的 AI 建议。
- **Suppressed candidates**：证据不可靠、涉及脱敏占位符或已被有效反馈抑制的候选项，只显示安全原因码和数量。

## GitHub Actions

调用仓库需要完整 Git 历史、最小评论权限和一个已审核的不可变 Action 引用。以下示例适用于同一仓库内的 PR：

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  contents: read
  issues: write
  pull-requests: write

concurrency:
  group: ai-code-review-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0

      - uses: lavyoung/ai-code-review@<trusted-full-commit-sha>
        with:
          output-language: zh-CN
          comment-enabled: "true"
          typescript-enabled: "true"
          secret-scan-enabled: "true"
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

将 `<trusted-full-commit-sha>` 替换为发布后审核过的完整提交 SHA；可用 `git rev-parse v0.1.0` 查询。Action 会使用 GitHub
自动提供的 Token 发布评论，不应手工输出 Token。

**Fork PR 限制：** GitHub 不会向来自 Fork 的 `pull_request` 工作流提供仓库 Secret，因此外部 Fork 不运行 DeepSeek 或发布
摘要评论；它应只运行 Java/TypeScript AST、密钥扫描和 `upload: never` 的 SARIF 等无 Secret 阶段。本仓库的
[`ai-code-review.yml`](.github/workflows/ai-code-review.yml) 已按此拆分 Fork 与同仓库 PR。不要为了注入 Secret 改用
`pull_request_target` 并 checkout Fork 的 PR Head。

Composite Action 输入包括 `event`（默认 `pull-request`，可设为 `push`）、`output-language`、`comment-enabled`、
`deepseek-enabled`、`typescript-enabled`、
`typescript-ast-enabled`、`java-ast-enabled`、`sarif-enabled` / `sarif-report` / `sarif-attestation`、
`secret-scan-enabled`、
`sandbox-test-enabled` /
`sandbox-test-report`、`run-record-path`、`quality-store-enabled` / `quality-store-endpoint` 和 `max-model-input-chars`。

### Push 自动审查

在发布包含 `event: push` 的 Action 版本后，可在受控分支启用以下 Job。必须使用完整历史；工具会从真实 GitHub Push 事件中校验
`before`、`after` 与当前检出的 `HEAD`，并且只审查 `before..after`。首次推送、分支删除和 Tag 推送会明确成功跳过。

```yaml
on:
  push:
    branches: [main, develop]

jobs:
  review-push:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    concurrency:
      group: ai-code-review-push-${{ github.repository }}-${{ github.ref }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: lavyoung/ai-code-review@<trusted-release-sha>
        with:
          event: push
          comment-enabled: "false"
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

Push 不创建 PR/MR 评论，也不自动修改、追加或重写 Git 提交；其结果显示在该提交的 GitHub Actions Check 和脱敏日志中。

若 Action 仓库是公开仓库，调用方无需额外访问设置；若是私有仓库，需要在 Action 仓库的 **Settings → Actions → General →
Access** 中授权同一用户或组织下的私有仓库访问。

## CodeUp Flow

CodeUp MR 评审使用：

```bash
ai-code-review review --provider codeup --event merge-request
```

除 `CODEUP_TOKEN` 外，Flow 环境必须提供 `AICR_CODEUP_API_BASE_URL`、`AICR_CODEUP_REPOSITORY_ID`、`CI_COMMIT_REF_NAME` 和
`CI_COMMIT_SHA`；可选 `AICR_CODEUP_ORGANIZATION_ID`。工具只会评审能唯一匹配当前源分支与提交的打开
MR，匹配不唯一或版本不一致时会拒绝执行，而不会猜测范围。要发布 CodeUp 摘要评论，请额外设置 `CODEUP_COMMENT_ENABLED=true`。

## 企业微信与评论

启用企业微信时，Webhook 只通过 Secret 注入：

```bash
WECOM_ENABLED=true
WECOM_WEBHOOK_URL=<secret-webhook-url>
```

通知和摘要评论默认不阻断流水线。需要将某一投递失败升级为失败时，分别设置 `WECOM_FAIL_ON_ERROR=true`、
`GITHUB_COMMENT_FAIL_ON_ERROR=true` 或 `CODEUP_COMMENT_FAIL_ON_ERROR=true`。投递会重试两次，最终状态仅以脱敏形式写入 CI
日志和摘要评论。

GitHub 与 CodeUp 均使用固定识别标志更新已有摘要评论，而不是在每次运行时重复创建评论。

## 质量记录与人工反馈

可选的本地 JSONL 记录仅保存运行 ID、发现指纹、严重级别、分析器摘要和投递状态，不保存代码、路径、描述、证据或密钥：

```bash
ai-code-review review --provider local --event manual --target main \
  --run-record-path .ai-code-review/runs.jsonl
```

使用 24 位十六进制发现指纹记录人工反馈：

```bash
ai-code-review feedback \
  --fingerprint 0123456789abcdef01234567 \
  --status false-positive \
  --expires-at 2026-12-31T00:00:00Z \
  --run-record-path .ai-code-review/runs.jsonl
```

`false-positive` 和 `not-applicable` 可在到期前抑制相同指纹的 AI 建议；`accepted` 与 `fixed` 会撤销抑制；已验证缺陷永不抑制。
`metrics` 可从本地记录计算脱敏聚合指标：

```bash
ai-code-review metrics --run-record-path .ai-code-review/runs.jsonl
```

本地 JSONL 在临时 CI Runner 上不会自动跨运行保存。需要跨仓库或跨运行统计时，应将脱敏记录作为 artifact 保存，或接入已启用的组织级
HTTPS 质量存储；当前自动抑制读取的是本地 JSONL。

## 退出码

| 退出码      | 含义                                                                                             |
|-------------|--------------------------------------------------------------------------------------------------|
| `0`         | 成功，且质量门禁通过。                                                                           |
| `100`       | 已验证发现触发质量门禁。                                                                         |
| `101`–`107` | 参数、配置、Git diff、必需分析器、验证器、评审协议或记录错误。                                   |
| `110`–`119` | 与 AI 提供方无关的执行错误类别，例如请求、认证、限流、超时、JSON、Schema、内容过滤或上下文限制。 |
| `120`       | 配置为阻断时，摘要评论发布失败。                                                                 |
| `121`       | 配置为阻断时，企业微信通知失败。                                                                 |

完整映射见 [src/interfaces/cli/exit-code.ts](src/interfaces/cli/exit-code.ts)。

## 安全边界

- 只使用已提交的 Git diff：手动评审为 `target...HEAD`，PR/MR 为目标提交与源提交的范围；未提交工作区不会进入模型上下文。
- 敏感文件的路径和内容、完整 diff、环境变量中的秘密和远端服务响应正文不会进入普通日志、评论或通知。
- 不要将 API Key、Token、Webhook 或签名密钥写入配置文件、命令行参数、提交历史、Release 说明或示例。
- 受控测试结果必须由独立沙箱生成；工具不会直接执行被评审仓库的测试脚本。

## 发布与维护

- 维护者发布 GitHub Action、GitHub Release 或 GitHub Packages 时，请遵循[发布指南](docs/guides/release.md)。
- 架构、误报治理与后续演进决策见 [设计方案](docs/design/DESIGN_PLAN.md)
  和 [评审质量架构](docs/design/REVIEW-QUALITY-ARCHITECTURE.md)。
- GitHub Packages 包名为 `@lavyoung/ai-code-review`，Registry 为 `https://npm.pkg.github.com`；安装私有包时，使用拥有
  `read:packages` 权限的凭据，并通过 Secret 注入 CI。
