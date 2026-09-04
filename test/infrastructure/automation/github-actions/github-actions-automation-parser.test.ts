import {describe, expect, it} from "vitest";
import {classifyRepositoryFile} from "../../../../src/domain/automation/policy/classify-repository-file.js";
import {GitHubActionsAutomationParser} from "../../../../src/infrastructure/automation/github-actions/github-actions-automation-parser.js";

const parser = new GitHubActionsAutomationParser();
const path = ".github/workflows/ci.yml";

describe("GitHubActionsAutomationParser", () => {
    it("maps a workflow into platform-neutral facts without executing its configuration", () => {
        const result = parser.parse({
            path,
            classification: classifyRepositoryFile(path),
            content: `name: CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@0123456789012345678901234567890123456789
      - uses: actions/setup-node@v4
      - run: npm test
  reusable:
    uses: ./.github/workflows/reusable.yml
  containerized:
    container: ghcr.io/example/runner@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    steps: []
`,
        });

        expect(result).toMatchObject({
            status: "parsed",
            definition: {
                platformId: "github-actions",
                reachability: "active",
                triggers: [{name: "push"}, {name: "pull_request"}],
                capabilities: expect.arrayContaining(["external-action", "reusable-workflow", "script"]),
                jobs: expect.arrayContaining([expect.objectContaining({
                    id: "build",
                    trustBoundary: "mixed",
                    permissions: [{name: "contents", access: "read"}],
                    steps: [
                        {kind: "action", reference: "actions/checkout@0123456789012345678901234567890123456789"},
                        {kind: "action", reference: "actions/setup-node@v4"},
                        {kind: "script"},
                    ],
                })]),
                externalReferences: expect.arrayContaining([
                    expect.objectContaining({
                        kind: "action",
                        reference: "actions/checkout@0123456789012345678901234567890123456789",
                        immutability: "pinned",
                    }),
                    expect.objectContaining({
                        kind: "action",
                        reference: "actions/setup-node@v4",
                        immutability: "mutable",
                    }),
                    expect.objectContaining({
                        kind: "reusable-workflow",
                        reference: "./.github/workflows/reusable.yml",
                        immutability: "unknown",
                    }),
                    expect.objectContaining({kind: "container", immutability: "pinned"}),
                ]),
            },
        });
        expect(result.definition?.platformFacts).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: "automation-parse", source: "automation-parser"}),
            expect.objectContaining({kind: "automation-trigger"}),
            expect.objectContaining({kind: "automation-permission"}),
            expect.objectContaining({kind: "automation-external-reference"}),
        ]));
    });

    it("does not parse documentation examples or invalid and oversized YAML", () => {
        expect(parser.parse({
            path: "docs/workflow.yml",
            classification: classifyRepositoryFile("docs/workflow.yml"),
            content: "jobs:\n  demo:\n    steps: []\n",
        })).toEqual({status: "not-applicable"});

        expect(parser.parse({
            path,
            classification: classifyRepositoryFile(path),
            content: "jobs: [invalid",
        })).toEqual({status: "invalid"});

        expect(parser.parse({
            path,
            classification: classifyRepositoryFile(path),
            content: "#".repeat(256 * 1024 + 1),
        })).toEqual({status: "resource-limit"});

        expect(parser.parse({
            path,
            classification: classifyRepositoryFile(path),
            content: `anchor: &value [safe]\naliases: [${Array.from({length: 33}, () => "*value").join(", ")}]`,
        })).toEqual({status: "resource-limit"});

        const nestedYaml = Array.from({length: 34}, (_, index) => `${"  ".repeat(index)}level${index}:`)
            .concat(`${"  ".repeat(34)}value: true`)
            .join("\n");
        expect(parser.parse({
            path,
            classification: classifyRepositoryFile(path),
            content: nestedYaml,
        })).toEqual({status: "resource-limit"});
    });
});
