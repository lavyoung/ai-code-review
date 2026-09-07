import {describe, expect, it} from "vitest";
import {compareCommittedContracts} from "../../../src/infrastructure/impact/contract-compatibility-rules.js";

describe("compareCommittedContracts", () => {
    it("detects required input and successful response removals in OpenAPI", () => {
        const base = `openapi: 3.1.0
paths:
  /users:
    get:
      parameters:
        - {in: query, name: limit, required: false}
      responses:
        '200': {description: ok}
`;
        const head = `openapi: 3.1.0
paths:
  /users:
    get:
      parameters:
        - {in: query, name: limit, required: true}
      responses:
        '204': {description: empty}
`;

        const result = compareCommittedContracts("openapi", base, head);

        expect(result.complete).toBe(true);
        expect(result.changes.map((change) => change.rule)).toEqual(expect.arrayContaining([
            "openapi-parameter-became-required",
            "openapi-success-response-removed",
        ]));
    });

    it("detects removed AsyncAPI v2 channels and operations", () => {
        const base = "asyncapi: 2.6.0\nchannels:\n  users:\n    publish:\n      message: {name: User}\n  audit:\n    subscribe:\n      message: {name: Audit}\n";
        const head = "asyncapi: 2.6.0\nchannels:\n  users: {}\n";

        const result = compareCommittedContracts("asyncapi", base, head);

        expect(result.complete).toBe(true);
        expect(result.changes.map((change) => change.rule)).toEqual(expect.arrayContaining([
            "asyncapi-operation-removed",
            "asyncapi-channel-removed",
        ]));
    });

    it("detects JSON Schema instance acceptance narrowing", () => {
        const base = JSON.stringify({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {status: {type: ["string", "null"], enum: ["active", "disabled", null]}},
        });
        const head = JSON.stringify({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            required: ["status"],
            additionalProperties: false,
            properties: {status: {type: "string", enum: ["active"]}},
        });

        const result = compareCommittedContracts("json-schema", base, head);

        expect(result.complete).toBe(true);
        expect(result.changes.map((change) => change.rule)).toEqual(expect.arrayContaining([
            "json-schema-required-property-added",
            "json-schema-additional-properties-disabled",
            "json-schema-type-narrowed",
            "json-schema-enum-narrowed",
        ]));
    });

    it("does not classify a contract version-family migration", () => {
        const result = compareCommittedContracts(
            "openapi",
            "openapi: 3.0.3\npaths: {}\n",
            "openapi: 3.1.0\npaths: {}\n",
        );

        expect(result).toEqual({changes: [], complete: false});
    });

    it("does not classify JSON Schema composition that the v1 ruleset cannot resolve", () => {
        const result = compareCommittedContracts(
            "json-schema",
            JSON.stringify({
                $schema: "https://json-schema.org/draft/2020-12/schema",
                allOf: [{type: "string"}],
            }),
            JSON.stringify({
                $schema: "https://json-schema.org/draft/2020-12/schema",
                allOf: [{type: "number"}],
            }),
        );

        expect(result).toEqual({changes: [], complete: false});
    });

    it("does not classify an invalid replacement AsyncAPI operation as a removal", () => {
        const result = compareCommittedContracts(
            "asyncapi",
            "asyncapi: 2.6.0\nchannels:\n  users:\n    publish: {}\n",
            "asyncapi: 2.6.0\nchannels:\n  users:\n    publish: invalid\n",
        );

        expect(result).toEqual({changes: [], complete: false});
    });
});
