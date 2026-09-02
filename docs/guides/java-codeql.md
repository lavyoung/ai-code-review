# 统一 AI Code Review 中的 Java CodeQL 阶段

CodeQL 不是另一套 Java 评审产品，也不应要求调用方维护独立的 `java-codeql.yml`。它是 `ai-code-review.yml` 内的一个可选确定性
Java 分析阶段：生成 SARIF，为同一次 AI 代码审查提供可验证的定位证据，再与 AI 的改动影响和缺陷分析汇总输出。项目的总原则见
[项目军规](../design/PROJECT_CHARTER.md)。

CodeQL 对 Java 支持 `none`、`autobuild` 和 `manual` 三种构建模式；`none` 不需要构建但可能遗漏依赖于生成代码或构建配置的告警。
需要更高精度时，应在无 Secret 的工作流中使用 `manual`，并只运行项目明确需要的构建命令。不要把 DeepSeek、SARIF 私钥或其他高权限
凭据放在执行构建的同一任务中。

## 无 Secret 的 Java CodeQL 阶段

将下面的步骤加入调用方现有的 `.github/workflows/ai-code-review.yml` 的同一 `review` job，置于检出提交之后。它仍是原有的
`pull_request_target` 评审工作流：只用 CodeQL `build-mode: none` 读取源码，不执行 Maven、Gradle、测试或 PR 脚本。GitHub 的
CodeQL advanced setup 要求工作流包含 `security-events: write`，因此在现有 `permissions` 中增加该最小权限；本示例仍以
`upload: never` 禁止将 SARIF 上传到 GitHub Code Scanning。

```yaml
      - name: Initialize Java CodeQL evidence stage
        uses: github/codeql-action/init@v4
        with:
          languages: java
          build-mode: none

      - name: Analyze Java code
        uses: github/codeql-action/analyze@v4
        with:
          output: ${{ github.workspace }}/sarif-results
          upload: never

      - name: Locate generated SARIF evidence
        id: sarif
        shell: bash
        run: |
          set -euo pipefail
          shopt -s nullglob
          reports=("$GITHUB_WORKSPACE"/sarif-results/*.sarif)
          if [[ ${#reports[@]} -ne 1 ]]; then
            echo "Expected exactly one generated SARIF report." >&2
            exit 1
          fi
          printf 'path=%s\n' "${reports[0]}" >> "$GITHUB_OUTPUT"

      - name: Run unified AI Code Review
        uses: lavyoung/ai-code-review@<audited-action-ref>
        with:
          output-language: zh-CN
          comment-enabled: "true"
          deepseek-enabled: "true"
          sarif-enabled: "true"
          sarif-report: ${{ steps.sarif.outputs.path }}
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

将 `<audited-action-ref>` 替换为审核过的完整提交 SHA 或受维护的发布 Tag。该步骤最终只产生一份 `AI Code Review` 摘要：CodeQL
提供 SARIF 定位证据，DeepSeek 提供跨文件的改动影响、逻辑缺陷和设计风险分析。导入的 SARIF 默认是 `grounded`，不会因为扫描工具或
PR 产物可被替换而直接成为质量门禁。

## 提升为质量门禁的前提

若要让 SARIF 结果成为 `verified`，不能在上述工作流直接加入 `SARIF_SIGNING_PRIVATE_KEY`。必须由隔离的可信任务在同一完整提交上
生成报告和证明，并将报告、证明安全地传递给验证任务；验证任务仅设置 `SARIF_VERIFICATION_PUBLIC_KEY`。详细证明协议和命令见
[README 的 SARIF 信任边界](../../README.md#sarif-信任边界)。

这项隔离是必需的：若私钥与可执行 PR 构建的步骤处于同一任务，PR 代码可以伪造任意通过门禁的报告。对于外部 Fork PR，保持
`build-mode: none`，不要在统一评审工作流中加入可执行 PR 构建步骤或私钥。

## 使用 Maven 或 Gradle 的精确构建

当项目已确认构建步骤且无凭据暴露时，将 `build-mode` 改为 `manual`，并在 `init` 和 `analyze` 之间加入项目的确定性构建命令，例如：

```yaml
      - name: Build Java for CodeQL
        run: ./mvnw --batch-mode --no-transfer-progress -DskipTests verify
```

不要照搬此命令到 Gradle、多模块或需要私有依赖凭据的项目；应使用该项目已有的无 Secret CI 构建命令。若手动构建失败，先修复无
Secret CI，再考虑以 `autobuild` 作为兼容方案。
