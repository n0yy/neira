import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  getModelContextLimit,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("openai-compatible-custom")).toBe(false);
    expect(endpointIdFromCompatModel("openai-compatible-custom")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves the static model id from the registry", () => {
    expect(resolveModel("openai-compatible-custom").provider).toBe(
      "openai-compatible",
    );
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for the known model", () => {
    expect(getModelContextLimit("openai-compatible-custom")).toBe(128_000);
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [endpoint]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("keeps reasoning for the static openai-compatible model too", () => {
    expect(modelKeepsReasoning(resolveModel("openai-compatible-custom"))).toBe(
      true,
    );
  });
});

describe("model sampling capabilities", () => {
  it("defaults unknown provider models to temperature support", () => {
    expect(modelSupportsTemperature("openai-compatible", "custom-model")).toBe(
      true,
    );
  });

  it("allocates a reasoning output budget for gpt-oss-shaped model ids", () => {
    expect(
      modelUsesReasoningTokens("openai-compatible", "openai/gpt-oss-20b"),
    ).toBe(true);
  });

  it("does not allocate a reasoning output budget for an ordinary model id", () => {
    expect(
      modelUsesReasoningTokens("openai-compatible", "llama-3.3-70b"),
    ).toBe(false);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});
