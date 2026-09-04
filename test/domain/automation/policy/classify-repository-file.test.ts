import {describe, expect, it} from "vitest";
import {classifyRepositoryFile} from "../../../../src/domain/automation/policy/classify-repository-file.js";

describe("classifyRepositoryFile", () => {
    it("recognizes only declared GitHub workflow entry paths as active automation", () => {
        expect(classifyRepositoryFile(".github/workflows/ci.yml")).toEqual({
            path: ".github/workflows/ci.yml",
            kind: "executable-automation",
            reachability: "active",
            reasons: ["github-actions-workflow-path"],
        });
        expect(classifyRepositoryFile("docs/examples/workflow.yml")).toMatchObject({
            kind: "documentation-example",
            reachability: "inactive",
        });
    });

    it("keeps templates and unrecognized configuration conservative", () => {
        expect(classifyRepositoryFile(".github/workflow-templates/release.yaml")).toMatchObject({
            kind: "automation-template",
            reachability: "unknown",
            reasons: ["github-actions-template-path"],
        });
        expect(classifyRepositoryFile("config/pipeline.yml")).toMatchObject({
            kind: "unknown-configuration",
            reachability: "unknown",
            reasons: ["configuration-file-extension"],
        });
    });
});
