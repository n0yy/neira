import { describe, expect, it } from "vitest";
import type { CustomEndpoint } from "../config";
import { resolveReasoningProviderOptions, type LocalProviderConfig } from "./agent";
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
