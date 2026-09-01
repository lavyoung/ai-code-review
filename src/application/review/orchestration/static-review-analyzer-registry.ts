import type {
    ReviewAnalyzer,
    ReviewAnalyzerRegistry,
} from "../ports/review-analyzer-port.js";

/** 由 bootstrap 装配固定分析器集合的注册表，不加载运行时第三方插件。 */
export class StaticReviewAnalyzerRegistry implements ReviewAnalyzerRegistry {
    private readonly analyzers: ReadonlyMap<string, ReviewAnalyzer>;

    public constructor(analyzers: readonly ReviewAnalyzer[]) {
        const identifiers = analyzers.map((analyzer) => analyzer.identity.id);
        if (new Set(identifiers).size !== identifiers.length) {
            throw new Error("Review analyzer identifiers must be unique.");
        }

        this.analyzers = new Map(analyzers.map((analyzer) => [analyzer.identity.id, analyzer]));
    }

    public resolve(analyzerId: string): ReviewAnalyzer | undefined {
        return this.analyzers.get(analyzerId);
    }
}
