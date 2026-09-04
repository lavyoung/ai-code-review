import type {
    AutomationParserAdapter,
    AutomationParserRegistry,
} from "../ports/automation-parser-adapter.js";

/** 由 bootstrap 装配的固定自动化解析器集合。 */
export class StaticAutomationParserRegistry implements AutomationParserRegistry {
    private readonly parsers: ReadonlyMap<string, AutomationParserAdapter>;

    public constructor(parsers: readonly AutomationParserAdapter[]) {
        const platformIds = parsers.map((parser) => parser.platformId);
        if (new Set(platformIds).size !== platformIds.length) {
            throw new Error("Automation parser platform identifiers must be unique.");
        }
        this.parsers = new Map(parsers.map((parser) => [parser.platformId, parser]));
    }

    public resolve(platformId: string): AutomationParserAdapter | undefined {
        return this.parsers.get(platformId);
    }
}
