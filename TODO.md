# 后续实施交接清单

> 最后更新：2026-09-04
>
> 目标：本仓库是 AI 辅助代码质量审查工具。它以已提交 Git 变更为范围，先提供可验证的静态/受控执行证据，再让 AI 解释变更影响、潜在缺陷和测试义务，供人工审查决策。AI 建议本身不得成为 CI 门禁。

## 0. 接续前必读

- 总体设计：[REVIEW-QUALITY-ARCHITECTURE.md](docs/design/REVIEW-QUALITY-ARCHITECTURE.md)
- 质量优化路线：[AI-REVIEW-QUALITY-OPTIMIZATION.md](docs/design/AI-REVIEW-QUALITY-OPTIMIZATION.md)
- 项目目标与安全边界：[PROJECT_CHARTER.md](docs/design/PROJECT_CHARTER.md)
- 项目根目录的 `AGENTS.md` 是本地约束文件；不得修改或纳入提交。

所有实现必须保持 DDD 边界：领域模型与策略不依赖 GitHub、环境变量、HTTP 或具体 AI 提供方；平台和外部系统差异放在基础设施适配器中。

## 1. 当前状态

已完成的阶段性能力：

- 阶段 A：事实、断言、验证状态与 AI advisory/确定性 defect 的语义隔离。
- 阶段 B：文件分类、自动化配置 IR、GitHub Actions 解析和安全规则基础。
- 阶段 C 的基础：已锚定的 TypeScript/Java import 与源码变更关系、契约变更识别、测试资产发现、测试义务与影响覆盖状态。
- 受控沙箱签名报告：通过测试、契约验证、已登记消费者兼容性证明均须验签且与当前 `HEAD` 对齐。
- 受审核的 `docs/context/capabilities.yml` 与 `docs/context/consumers.yml` 目录；目录失效、过期或不可读时必须降级为上下文不可用。
- 模型输入预算：安全 diff 占 75%，只保留与其仍有关联的影响包占 25%；裁剪即表示 `unknown`，不得解释为无影响。

当前版本为 `0.1.2`。最近一次验证结果：`69` 个测试文件、`217` 项测试通过，`npm run build` 与 `git diff --check` 通过。

## 2. 当前工作区（先提交）

当前工作区包含一组相互关联、尚未提交的影响上下文增强改动。建议先完成检查并提交，避免后续任务与该批次混杂。

建议提交信息：

```text
feat(impact): enrich governed review context and compatibility evidence
```

该批次的关键内容：

- `ImpactPackage` 受预算约束并只投影仍关联安全 diff 的上下文；
- 业务能力和外部消费者目录均为 HEAD 中的受审核、可过期目录；
- 签名报告可产生契约验证与已登记消费者兼容性证明；
- 消费者兼容性必须同时匹配目录中的消费者 ID、不可变快照 SHA、契约路径和本次契约锚点；
- 不满足任何条件时 `compatibility` 必须保持 `not-assessable`；
- README、架构文档及单元测试已同步。

注意：不要误把未跟踪的 `AGENTS.md` 加入暂存区。提交前先确认 `git status --short` 和暂存内容。

## 3. 剩余实施计划

### P0：完成阶段 C 的影响证据

1. TypeScript / Java 符号身份与调用关系
   - 建立跨 base/head 的 `SymbolIdentity`，覆盖重命名、移动、重载、实现替换、多候选和无法匹配。
   - 增加调用、实现、继承/接口、配置、事件和持久化影响边。
   - 动态 import、反射、代码生成和不支持语言必须显式标记 `unknown`/`not-assessable`，不得静默遗漏。

2. 契约差异与兼容策略
   - 解析受支持的 OpenAPI、AsyncAPI、JSON Schema 变更。
   - 区分“契约文件有改动”和“已确认的破坏性变更”。
   - 消费者目录只代表已登记消费者，不能外推为完整生产消费者。

3. 测试发现与覆盖关联
   - 增强 Vitest/Jest/JUnit 的测试资产识别。
   - 接入可信覆盖报告时，必须记录测试 ID、执行 revision、覆盖类型和影响路径关联方式。
   - 文件存在、名称相似或普通行覆盖率不能单独证明义务覆盖。

### P1：完成阶段 D 的可信回归判定

1. Base/head 受控沙箱比较
   - 设计并实现签名 `RevisionComparison` 证明，包含 base/head revision、运行环境摘要、依赖摘要、测试选择摘要与结果。
   - 只有“base 通过、head 失败、环境与选择策略可比、失败能关联本次影响路径、测试可靠”同时成立时，才可称为 `verified regression`。
   - 没有基线的当前失败仍可作为确定性测试失败处理，但不得称为回归。

2. 测试可靠性策略
   - 支持重跑上限、flaky 分类、隔离名单、最小观察窗口和人工确认。
   - flaky/unknown 测试不能单独证明回归或覆盖。

3. 可信外部事实
   - 新增限资源、无凭据、来源受信任的 `ExternalFactResolver` 端口与适配器。
   - 失败、超时、无权限或来源不可信时明确降级；模型不得填补外部版本、SHA 或镜像事实。

### P2：阶段 E 的评测与运营治理

1. 离线评测集与 shadow mode。
2. 将提示词、规则、模型版本、分类维度写入脱敏运行记录。
3. 按类别计算采纳率、误报率、遗漏率和人工处理成本。
4. 低采纳率只能在样本量、时间窗口、跨维护者覆盖和人工审批满足时降级；不得自动关闭安全和确定性规则。

## 4. 不可违反的安全与质量规则

- 仅评审已提交范围：Push 使用 `beforeSha..afterSha`，PR/MR 使用目标与源的差异，手动使用 `target...HEAD`；不评审工作区未提交文件。
- 原始 diff、密钥、敏感路径和敏感文件内容不得进入普通日志、摘要评论或模型输入。
- AI 仅消费脱敏、可执行数据边界内的内容；AI 不可自行决定严重级别、验证方法、门禁资格或最终处置。
- `unknown`、`not-assessable`、`not-demonstrated` 不是缺陷、回归或“缺少测试”的证据。
- 任何 `demonstrated`/`verified` 都必须可追溯至本次变更锚点、可信来源和当前 revision。
- 不要为了未来假设提前加入无使用方的抽象或配置；每一层必须服务于已定义的领域边界。

## 5. 每次改动的最低验证

```powershell
npm run test
npm run build
git diff --check
git status --short
```

行为改动至少覆盖成功与失败/降级路径；外部证据还需覆盖：签名无效、revision 不匹配、过期目录、未知映射和敏感信息不外泄。

## 6. 建议执行顺序

1. 提交第 2 节的当前工作区。
2. 实施 TypeScript/Java 的符号与调用影响索引，并先以观察模式写入影响包。
3. 实施版本化契约差异和可信测试覆盖关联。
4. 实施受控沙箱 base/head 比较与测试可靠性，最后才允许输出“已验证回归”。
5. 建立评测和反馈闭环，再依据数据调整 AI 提示词、规则与默认策略。
