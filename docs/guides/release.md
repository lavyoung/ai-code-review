# 发布指南

本指南面向 `ai-code-review` 的维护者，说明如何发布 GitHub Action、GitHub Release，以及可选的 GitHub Packages CLI
包。三者是相互独立的发布物：GitHub Action 通过不可变 Git 引用供工作流使用；GitHub Release 是面向用户的版本说明；GitHub
Packages 仅在需要通过 npm 安装 CLI 时发布。

## 发布前检查

1. 将本次发布的变更合并到 `master`，并确认该分支是准备发布的唯一来源。
2. 确认 `package.json` 的 `version` 是目标版本，例如 `0.1.0`。CLI 的 `--version` 直接读取此值，不应再维护第二份版本号。
3. 在干净的工作区执行以下检查：

   ```bash
   npm ci
   npm run test
   npm run build
   npm run package:check
   ```

4. 审核本次差异和提交历史，确认不存在 API Key、Token、Webhook、私有路径或测试密钥。

## 分支和 Tag

发布 Tag 使用 `v<package.json 中的版本>`，例如包版本为 `0.1.0` 时使用 `v0.1.0`。

GitHub 不禁止同名分支和 Tag，但这会造成引用歧义，并且 Release 页面会显示警告。 **不要保留与发布 Tag 同名的分支。** 若当前存在
`v0.1.0` 分支，应先确认它已经合并到 `master`，再删除该分支：

```bash
git switch master
git pull --ff-only origin master
git branch -d v0.1.0
git push origin --delete v0.1.0
```

`git branch -d` 会拒绝删除尚未合并的本地分支；若命令拒绝执行，应先完成合并，不能使用强制删除绕过检查。

随后从 `master` 创建并推送带注释的 Tag：

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

## 创建 GitHub Release

在 GitHub 仓库中打开 **Releases → Draft a new release**，按以下内容填写：

- **Choose a tag**：选择已推送的 `v0.1.0`；不要在此页面从同名分支创建 Tag。
- **Target**：确认 Tag 指向 `master` 上已验证的提交。
- **Release title**：`v0.1.0 – Initial public release`（后续版本可使用对应版本号与简短说明）。
- **Release notes**：记录用户可见的功能、兼容性影响、配置变更和已知限制；不要包含密钥、完整日志或敏感路径。
- **Set as a pre-release**：仅用于预览版本；正式版本保持关闭。
- **Publish this release to the GitHub Marketplace**：只有决定上架 Marketplace 且已接受其开发者协议时才勾选；普通 GitHub
  Action 发布不需要此项。

发布后，该 Tag 即可作为 Action 引用。生产工作流仍建议固定到已审核的完整提交 SHA，而不是可变分支名：

```yaml
- uses: lavyoung/ai-code-review@<trusted-full-commit-sha>
```

可用以下命令确认 Tag 的实际提交 SHA：

```bash
git rev-parse v0.1.0
git ls-remote --tags origin v0.1.0
```

## 可选：发布 GitHub Packages

仅当需要让其他项目通过 `npm install @lavyoung/ai-code-review` 使用 CLI 时，再发布 GitHub Packages。该包的 Registry 已由
`package.json` 的 `publishConfig` 固定为 `https://npm.pkg.github.com`。

发布者应使用具有包发布权限的身份登录 Registry，并确保凭据只通过本机凭据存储或 CI Secret 提供，随后执行：

```bash
npm publish
```

在 GitHub Actions 中自动发布时，工作流必须显式授予 `packages: write`，并通过 `NODE_AUTH_TOKEN`
注入令牌。不得将令牌写入仓库、发布说明或构建日志。发布完成后，在 GitHub 仓库的 **Packages** 区域确认新版本可见，并从一个干净环境安装该精确版本进行验证。

## 发布后验证

1. 打开 Release 页面，确认版本号、Tag 和目标提交正确。
2. 创建一个最小测试 PR，确认 `CI / Build and test` 与 AI 评审工作流都成功运行，且摘要评论可更新。
3. 在调用方仓库使用 Release Tag 或完整 SHA 运行一次 Composite Action；确认依赖安装、构建、DeepSeek 调用和 GitHub 摘要评论均正常。
4. 若启用了分支保护，Required status checks 必须选择当前实际产生的检查名称。旧工作流遗留的检查会一直显示为
   `Expected — Waiting for status to be reported`，此时应先移除旧名称，合并工作流迁移后用新 PR 验证，再将新的检查重新设为必需。

## 失败时的处理

- Release 页面提示“Branch with this tag name already exists”：按“分支和 Tag”一节确认分支已合并，然后删除或重命名同名分支，再创建
  Tag。
- 无法合并 PR，且检查显示 `Expected`：分支保护仍在要求不再运行的检查名称；更新 Required status checks 后重新触发 PR。
- GitHub Packages 发布失败：检查发布身份对该仓库的包写入权限、Registry 配置和 `NODE_AUTH_TOKEN`，但不要在日志中打印令牌或
  `.npmrc` 的认证字段。
