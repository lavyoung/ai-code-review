import type { CodeChange } from "../../domain/review/code-change.js";
import type { ReviewAnalysis } from "../../domain/review/review-finding.js";

export interface AiReviewPort {
    review(codeChange: CodeChange): Promise<ReviewAnalysis>;
}
