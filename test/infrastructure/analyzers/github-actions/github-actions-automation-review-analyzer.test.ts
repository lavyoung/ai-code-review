import {describe, expect, it, vi} from "vitest";
import {
    GitHubActionsAutomationParser
} from "../../../../src/infrastructure/automation/github-actions/github-actions-automation-parser.js";
import {
    GitHubActionsAutomationReviewAnalyzer
} from "../../../../src/infrastructure/analyzers/github-actions/github-actions-automation-review-analyzer.js";

const path = ".github/workflows/ci.yml";
const codeChange = {
    diff: "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n",
    files: [{path, status: "modified" as const}],
    chunks: [{
        id: "workflow-chunk",
        path,
        newRange: {startLine: 1, endLine: 8},
        content: `@@ -0,0 +1,8 @@
+on: pull_request
+permissions:
+  contents: write
+jobs:
+  review:
+    steps:
+      - uses: actions/checkout@v4
+      - run: npm test`,
    }],
    excludedFileCount: 0,
    redactedValueCount: 0,
};

describe("GitHubActionsAutomationReviewAnalyzer", () => {
    it("reads only committed workflow content and emits anchored observation candidates", async () => {
        const readHeadFile = vi.fn().mockResolvedValue(`on: pull_request
permissions:
  contents: write
jobs:
  review:
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`);
        const analyzer = new GitHubActionsAutomationReviewAnalyzer(
            {readHeadFile},
            new GitHubActionsAutomationParser(),
        );

        await expect(analyzer.analyze({
            codeChange,
            rawCodeChange: {
                fileChanges: [{file: {path, status: "modified"}, diff: codeChange.diff}],
            },
            signal: AbortSignal.timeout(1_000),
        })).resolves.toMatchObject({
            summary: "GitHub Actions automation analysis parsed 1 workflow(s), produced 2 advisory candidate(s), and skipped 0 workflow(s).",
            findings: expect.arrayContaining([
                expect.objectContaining({
                    title: "Mutable automation dependency reference",
                    assertionType: "security-risk",
                    line: 7,
                    evidence: "+      - uses: actions/checkout@v4",
                }),
                expect.objectContaining({
                    title: "Untrusted automation trigger has write permission",
                    assertionType: "security-risk",
                    line: 1,
                    evidence: "+on: pull_request",
                }),
            ]),
        });
        expect(readHeadFile).toHaveBeenCalledWith(path, expect.any(AbortSignal));
    });

    it("does not inspect documentation or deleted workflows", async () => {
        const readHeadFile = vi.fn();
        const analyzer = new GitHubActionsAutomationReviewAnalyzer(
            {readHeadFile},
            new GitHubActionsAutomationParser(),
        );

        await expect(analyzer.analyze({
            codeChange: {...codeChange, files: [{path: "docs/example.yml", status: "modified"}]},
            rawCodeChange: {
                fileChanges: [
                    {file: {path: "docs/example.yml", status: "modified"}, diff: ""},
                    {file: {path, status: "deleted"}, diff: ""},
                ],
            },
            signal: AbortSignal.timeout(1_000),
        })).resolves.toEqual({
            summary: "GitHub Actions automation analysis parsed 0 workflow(s), produced 0 advisory candidate(s), and skipped 0 workflow(s).",
            findings: [],
        });
        expect(readHeadFile).not.toHaveBeenCalled();
    });
});
