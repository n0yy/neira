const createOpenAICompatibleMock = vi.hoisted(() =>
  vi.fn(() => () => ({ modelId: "mock" })),
);

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomEndpoint } from "../config";
import {
  buildLanguageModel,
  resolveReasoningProviderOptions,
  type LocalProviderConfig,
} from "./agent";
import type { ReasoningConfig } from "./reasoningEffort";

function reasoning(overrides: Partial<ReasoningConfig> = {}): ReasoningConfig {
  return {
    enabled: true,
    shape: "flat",
    levels: ["low", "medium", "xhigh"],
    defaultLevel: "medium",
    activeLevel: "",
    ...overrides,
  };
}

describe("buildLanguageModel: openai-compatible", () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
  });

  // Bug: this used to not pass `includeUsage: true`, so `stream_options.
  // include_usage` was never sent, and the server never returns a `usage`
  // object during streaming (confirmed live against a self-hosted
  // OpenAI-compatible endpoint: step.usage came back completely empty,
  // inputTokens/outputTokens both undefined, until this flag was added).
  it("passes includeUsage: true", async () => {
    const keys = { "openai-compatible": "test-key" } as never;
    await buildLanguageModel("openai-compatible", keys, "model-x", {
      openaiCompatibleBaseURL: "http://x/v1",
    });
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeUsage: true }),
    );
  });

  it("throws when no base URL is configured", async () => {
    const keys = { "openai-compatible": "test-key" } as never;
    await expect(
      buildLanguageModel("openai-compatible", keys, "model-x", {}),
    ).rejects.toThrow(/base URL/);
  });
});

describe("resolveReasoningProviderOptions", () => {
  it("returns undefined for a static model id (no reasoning config there)", () => {
    expect(
      resolveReasoningProviderOptions("openai-compatible-custom", {}),
    ).toBeUndefined();
  });

  it("returns undefined when the compat model id references an unknown endpoint", () => {
    expect(
      resolveReasoningProviderOptions("compat-missing", { customEndpoints: [] }),
    ).toBeUndefined();
  });

  it("returns undefined when reasoning is configured but disabled", () => {
    const endpoint: CustomEndpoint = {
      id: "ep1",
      name: "DGX Spark",
      baseURL: "http://localhost:8080/v1",
      modelId: "qwen3.8-flash-next",
      contextLimit: 262_000,
      reasoning: reasoning({ enabled: false }),
    };
    const local: LocalProviderConfig = { customEndpoints: [endpoint] };
    expect(
      resolveReasoningProviderOptions("compat-ep1", local),
    ).toBeUndefined();
  });

  it("resolves a named custom endpoint's reasoning config via its compat model id", () => {
    const endpoint: CustomEndpoint = {
      id: "ep1",
      name: "DGX Spark",
      baseURL: "http://localhost:8080/v1",
      modelId: "qwen3.8-flash-next",
      contextLimit: 262_000,
      reasoning: reasoning({
        shape: "chat-template-kwargs",
        levels: ["low", "medium", "xhigh"],
        defaultLevel: "medium",
        activeLevel: "",
      }),
    };
    const local: LocalProviderConfig = { customEndpoints: [endpoint] };
    expect(resolveReasoningProviderOptions("compat-ep1", local)).toEqual({
      "openai-compatible": { chat_template_kwargs: { reasoning_effort: "medium" } },
    });
  });

  it("defaults to the configured defaultLevel when no active level has been picked yet", () => {
    const endpoint: CustomEndpoint = {
      id: "ep1",
      name: "DGX Spark",
      baseURL: "http://localhost:8080/v1",
      modelId: "qwen3.8-flash-next",
      contextLimit: 262_000,
      reasoning: reasoning({
        shape: "openrouter",
        defaultLevel: "medium",
        activeLevel: "",
      }),
    };
    const local: LocalProviderConfig = { customEndpoints: [endpoint] };
    expect(resolveReasoningProviderOptions("compat-ep1", local)).toEqual({
      "openai-compatible": { reasoning: { effort: "medium" } },
    });
  });
});
