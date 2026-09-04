import type {AutomationDefinition} from "../../../domain/automation/model/automation-definition.js";
import type {RepositoryFileClassification} from "../../../domain/automation/model/repository-file-classification.js";

/** 自动化解析器输入；调用方负责从受信任的已提交内容读取正文。 */
export interface AutomationParseRequest {
    path: string;
    content: string;
    classification: RepositoryFileClassification;
}

/** 解析失败也以脱敏的稳定原因码返回，不输出配置正文。 */
export interface AutomationParseResult {
    status: "parsed" | "invalid" | "resource-limit" | "not-applicable";
    definition?: AutomationDefinition;
}

/** 每个平台只能在基础设施层实现自己的只读解析器。 */
export interface AutomationParserAdapter {
    readonly platformId: string;
    parse(request: AutomationParseRequest): AutomationParseResult;
}
