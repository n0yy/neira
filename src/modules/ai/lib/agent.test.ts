const createOpenAICompatibleMock = vi.hoisted(() =>
  vi.fn(() => () => ({ modelId: "mock" })),
);

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomEndpoint, ProviderId } from "../config";
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

describe("buildLanguageModel: openai-compatible-routed providers", () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
  });

  // Bug: none of these passed `includeUsage: true`, so `stream_options.
  // include_usage` was never sent, and the server never returns a `usage`
  // object during streaming (confirmed live against a self-hosted
  // OpenAI-compatible endpoint: step.usage came back completely empty,
  // inputTokens/outputTokens both undefined, until this flag was added).
  // ContextIndicator then silently fell back to a rough char/4 estimate
  // for the whole session, which is why "thinking" tokens looked uncounted:
  // the real bug was ALL usage tracking for these 7 providers, not
  // reasoning specifically.
  const cases: { provider: ProviderId; extra?: Record<string, unknown> }[] = [
    { provider: "deepseek" },
    { provider: "mistral" },
    { provider: "openrouter" },
    { provider: "openai-compatible", extra: { openaiCompatibleBaseURL: "http://x/v1" } },
    { provider: "lmstudio" },
    { provider: "mlx" },
    { provider: "ollama" },
  ];

  for (const { provider, extra } of cases) {
    it(`passes includeUsage: true for ${provider}`, async () => {
      const keys = { [provider]: "test-key" } as never;
      await buildLanguageModel(provider, keys, `model-${provider}`, extra);
      expect(createOpenAICompatibleMock).toHaveBeenCalledWith(
        expect.objectContaining({ includeUsage: true }),
      );
    });
  }
});

describe("resolveReasoningProviderOptions", () => {
  it("returns undefined for a curated cloud model id", () => {
    expect(
      resolveReasoningProviderOptions("claude-sonnet-5", {}),
    ).toBeUndefined();
  });

  it("returns undefined when the matching local config has no reasoning set", () => {
    expect(
      resolveReasoningProviderOptions("lmstudio-local", {}),
    ).toBeUndefined();
  });

  it("returns undefined when reasoning is configured but disabled", () => {
    const local: LocalProviderConfig = {
      lmstudioReasoning: reasoning({ enabled: false }),
    };
    expect(
      resolveReasoningProviderOptions("lmstudio-local", local),
    ).toBeUndefined();
  });

  it("builds flat providerOptions for lmstudio-local, keyed by the lmstudio provider name", () => {
    const local: LocalProviderConfig = {
      lmstudioReasoning: reasoning({ activeLevel: "low" }),
    };
    expect(resolveReasoningProviderOptions("lmstudio-local", local)).toEqual({
      lmstudio: { reasoning_effort: "low" },
    });
  });

  it("builds providerOptions for mlx-local, ollama-local, and openrouter-custom", () => {
    const local: LocalProviderConfig = {
      mlxReasoning: reasoning({ activeLevel: "medium" }),
      ollamaReasoning: reasoning({ activeLevel: "medium" }),
      openrouterReasoning: reasoning({ shape: "openrouter", activeLevel: "medium" }),
    };
    expect(resolveReasoningProviderOptions("mlx-local", local)).toEqual({
      mlx: { reasoning_effort: "medium" },
    });
    expect(resolveReasoningProviderOptions("ollama-local", local)).toEqual({
      ollama: { reasoning_effort: "medium" },
    });
    expect(
      resolveReasoningProviderOptions("openrouter-custom", local),
    ).toEqual({
      openrouter: { reasoning: { effort: "medium" } },
    });
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

  it("returns undefined when the compat model id references an unknown endpoint", () => {
    expect(
      resolveReasoningProviderOptions("compat-missing", { customEndpoints: [] }),
    ).toBeUndefined();
  });

  it("defaults to the configured defaultLevel when no active level has been picked yet", () => {
    const local: LocalProviderConfig = {
      openrouterReasoning: reasoning({
        shape: "openrouter",
        defaultLevel: "medium",
        activeLevel: "",
      }),
    };
    expect(
      resolveReasoningProviderOptions("openrouter-custom", local),
    ).toEqual({ openrouter: { reasoning: { effort: "medium" } } });
  });
});
