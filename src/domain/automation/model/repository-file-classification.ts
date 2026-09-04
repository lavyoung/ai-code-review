/** 自动化文件的可达性；未知状态不得被规则当作可执行配置。 */
export type AutomationReachability = "active" | "inactive" | "unknown";

/** 仓库文件进入自动化分析前的安全分类。 */
export type RepositoryFileKind =
    | "executable-automation"
    | "automation-template"
    | "documentation-example"
    | "unknown-configuration";

/** 分类结论必须可审计，不能仅由内容关键字猜测。 */
export type RepositoryFileClassificationReason =
    | "github-actions-workflow-path"
    | "github-actions-template-path"
    | "documentation-path"
    | "markdown-file"
    | "configuration-file-extension"
    | "unrecognized-path";

/** 不携带文件内容的仓库文件分类结果。 */
export interface RepositoryFileClassification {
    path: string;
    kind: RepositoryFileKind;
    reachability: AutomationReachability;
    reasons: readonly RepositoryFileClassificationReason[];
}
