import {describe, expect, it} from "vitest";
import {resolveAutomationDefinitionGraph} from "../../../../src/application/review/orchestration/resolve-automation-definition-graph.js";
import {StaticAutomationParserRegistry} from "../../../../src/application/review/orchestration/static-automation-parser-registry.js";
import {GitHubActionsAutomationParser} from "../../../../src/infrastructure/automation/github-actions/github-actions-automation-parser.js";

const parserRegistry = new StaticAutomationParserRegistry([new GitHubActionsAutomationParser()]);
const rootPath = ".github/workflows/root.yml";

describe("resolveAutomationDefinitionGraph", () => {
    it("loads reachable local reusable workflows without turning context into a report target", async () => {
        const readHeadFile = async (path: string): Promise<string | undefined> => path === ".github/workflows/reusable.yml"
            ? "on: workflow_call\njobs:\n  build:\n    steps:\n      - run: npm test\n"
            : undefined;

        const result = await resolveAutomationDefinitionGraph({
            platformId: "github-actions",
            rootPath,
            rootContent: "on: pull_request\njobs:\n  reusable:\n    uses: ./.github/workflows/reusable.yml\n",
            signal: AbortSignal.timeout(1_000),
        }, {
            committedFileReader: {readHeadFile},
            automationParserRegistry: parserRegistry,
        });

        expect(result).toMatchObject({
            parseStatus: "parsed",
            graph: {
                unavailableReferenceCount: 0,
                cycleCount: 0,
                depthLimitHit: false,
            },
        });
        expect(result.graph?.reachableDefinitions.map((definition) => definition.source.classification.path)).toEqual([
            rootPath,
            ".github/workflows/reusable.yml",
        ]);
    });

    it("records a local reusable-workflow cycle without recursively loading it", async () => {
        const readHeadFile = async (path: string): Promise<string | undefined> => path === ".github/workflows/reusable.yml"
            ? "on: workflow_call\njobs:\n  root:\n    uses: ./.github/workflows/root.yml\n"
            : undefined;

        await expect(resolveAutomationDefinitionGraph({
            platformId: "github-actions",
            rootPath,
            rootContent: "on: pull_request\njobs:\n  reusable:\n    uses: ./.github/workflows/reusable.yml\n",
            signal: AbortSignal.timeout(1_000),
        }, {
            committedFileReader: {readHeadFile},
            automationParserRegistry: parserRegistry,
        })).resolves.toMatchObject({
            graph: {
                reachableDefinitions: expect.any(Array),
                cycleCount: 1,
                unavailableReferenceCount: 0,
            },
        });
    });
});
