import {describe, expect, it} from "vitest";
import {resolveCommittedTypeScriptProjects} from "../../../src/infrastructure/impact/committed-typescript-configuration.js";

describe("resolveCommittedTypeScriptProjects", () => {
    it("resolves project options with a committed relative extends chain", () => {
        const projects = resolveCommittedTypeScriptProjects({
            path: "tsconfig.json",
            content: "{\"files\":[],\"references\":[{\"path\":\"./packages/core\"}]}",
            supportingConfigurations: [{
                path: "packages/core/tsconfig.json",
                content: "{\"extends\":\"../../config/strict.json\",\"compilerOptions\":{\"composite\":true}}",
            }, {
                path: "config/strict.json",
                content: "{\"compilerOptions\":{\"strictNullChecks\":true}}",
            }],
        });

        expect(projects).toEqual([expect.objectContaining({
            configurationPath: "packages/core/tsconfig.json",
            directory: "packages/core",
            options: expect.objectContaining({composite: true, strictNullChecks: true}),
        })]);
    });

    it.each([{
        name: "repository escape",
        root: "{\"references\":[{\"path\":\"../outside\"}]}",
        supportingConfigurations: [],
    }, {
        name: "node_modules project",
        root: "{\"references\":[{\"path\":\"./node_modules/shared\"}]}",
        supportingConfigurations: [{
            path: "node_modules/shared/tsconfig.json",
            content: "{\"compilerOptions\":{\"composite\":true}}",
        }],
    }, {
        name: "project cycle",
        root: "{\"references\":[{\"path\":\"./packages/core\"}]}",
        supportingConfigurations: [{
            path: "packages/core/tsconfig.json",
            content: "{\"references\":[{\"path\":\"../..\"}]}",
        }],
    }, {
        name: "project depth overflow",
        root: "{\"references\":[{\"path\":\"./packages/level-1\"}]}",
        supportingConfigurations: [1, 2, 3, 4].map((level) => ({
            path: `packages/level-${level}/tsconfig.json`,
            content: `{\"references\":[{\"path\":\"../level-${level + 1}\"}]}`,
        })),
    }, {
        name: "ambiguous project ownership",
        root: "{\"references\":[{\"path\":\"./packages/core/tsconfig.app.json\"},{\"path\":\"./packages/core/tsconfig.test.json\"}]}",
        supportingConfigurations: [{
            path: "packages/core/tsconfig.app.json",
            content: "{\"compilerOptions\":{\"composite\":true}}",
        }, {
            path: "packages/core/tsconfig.test.json",
            content: "{\"compilerOptions\":{\"composite\":true}}",
        }],
    }, {
        name: "non-composite referenced project",
        root: "{\"references\":[{\"path\":\"./packages/core\"}]}",
        supportingConfigurations: [{
            path: "packages/core/tsconfig.json",
            content: "{\"compilerOptions\":{\"strict\":true}}",
        }],
    }, {
        name: "referenced project source escape",
        root: "{\"references\":[{\"path\":\"./packages/core\"}]}",
        supportingConfigurations: [{
            path: "packages/core/tsconfig.json",
            content: "{\"include\":[\"../../shared/**/*.ts\"],\"compilerOptions\":{\"composite\":true}}",
        }],
    }])("rejects $name", ({root, supportingConfigurations}) => {
        expect(resolveCommittedTypeScriptProjects({
            path: "tsconfig.json",
            content: root,
            supportingConfigurations,
        })).toBeUndefined();
    });
});
