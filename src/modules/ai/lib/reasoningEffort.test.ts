import { describe, expect, it } from "vitest";
import {
  buildReasoningRequestFields,
  isReasoningConfigUsable,
  resolveActiveReasoningLevel,
  type ReasoningConfig,
} from "./reasoningEffort";

function cfg(overrides: Partial<ReasoningConfig> = {}): ReasoningConfig {
  return {
    enabled: true,
    shape: "flat",
    levels: ["low", "medium", "xhigh"],
    defaultLevel: "medium",
    activeLevel: "",
    ...overrides,
  };
}

describe("isReasoningConfigUsable", () => {
  it("is false for null/undefined", () => {
    expect(isReasoningConfigUsable(null)).toBe(false);
    expect(isReasoningConfigUsable(undefined)).toBe(false);
  });

  it("is false when disabled", () => {
    expect(isReasoningConfigUsable(cfg({ enabled: false }))).toBe(false);
  });

  it("is false when there are no levels", () => {
    expect(isReasoningConfigUsable(cfg({ levels: [] }))).toBe(false);
  });

  it("is true when enabled with at least one level", () => {
    expect(isReasoningConfigUsable(cfg())).toBe(true);
  });
});

describe("resolveActiveReasoningLevel", () => {
  it("uses the remembered activeLevel when it's still a valid level", () => {
    expect(resolveActiveReasoningLevel(cfg({ activeLevel: "low" }))).toBe(
      "low",
    );
  });

  it("falls back to defaultLevel when activeLevel is empty", () => {
    expect(resolveActiveReasoningLevel(cfg({ activeLevel: "" }))).toBe(
      "medium",
    );
  });

  it("falls back to defaultLevel when activeLevel is stale (no longer in levels)", () => {
    expect(
      resolveActiveReasoningLevel(cfg({ activeLevel: "removed-level" })),
    ).toBe("medium");
  });

  it("falls back to the first level when defaultLevel is also stale", () => {
    expect(
      resolveActiveReasoningLevel(
        cfg({ activeLevel: "", defaultLevel: "gone" }),
      ),
    ).toBe("low");
  });
});

describe("buildReasoningRequestFields", () => {
  it("flat shape sends a top-level reasoning_effort field", () => {
    expect(buildReasoningRequestFields("flat", "xhigh")).toEqual({
      reasoning_effort: "xhigh",
    });
  });

  it("chat-template-kwargs shape nests reasoning_effort for llama.cpp", () => {
    expect(buildReasoningRequestFields("chat-template-kwargs", "xhigh")).toEqual({
      chat_template_kwargs: { reasoning_effort: "xhigh" },
    });
  });

  it("openrouter shape uses the unified reasoning.effort field", () => {
    expect(buildReasoningRequestFields("openrouter", "high")).toEqual({
      reasoning: { effort: "high" },
    });
  });
});
