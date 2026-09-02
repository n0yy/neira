import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => {
  const data = new Map<string, unknown>();
  const listeners: ((key: string, value: unknown) => void)[] = [];
  class LazyStore {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    }
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
      for (const l of listeners) l(key, value);
    }
    async save(): Promise<void> {}
    async entries(): Promise<[string, unknown][]> {
      return [...data.entries()];
    }
    async onChange(cb: (key: string, value: unknown) => void): Promise<() => void> {
      listeners.push(cb);
      return () => {};
    }
  }
  return { LazyStore };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import { usePreferencesStore } from "@/modules/settings/preferences";
import type { CustomEndpoint } from "../config";
import { persistActiveLevel, resolveTarget } from "./ReasoningEffortSwitcher";
import type { ReasoningConfig } from "../lib/reasoningEffort";

function reasoning(overrides: Partial<ReasoningConfig> = {}): ReasoningConfig {
  return {
    enabled: true,
    shape: "flat",
    levels: ["low", "medium", "xhigh"],
    defaultLevel: "medium",
    activeLevel: "low",
    ...overrides,
  };
}

describe("ReasoningEffortSwitcher: resolveTarget + persistActiveLevel", () => {
  it("picking a different level for a named custom endpoint updates its activeLevel", async () => {
    await usePreferencesStore.getState().init();
    const endpoint: CustomEndpoint = {
      id: "ep1",
      name: "DGX Spark",
      baseURL: "http://100.75.49.117:4000/v1",
      modelId: "qwen3.8-flash-next",
      contextLimit: 262_000,
      reasoning: reasoning({ activeLevel: "low" }),
    };
    usePreferencesStore.setState({ customEndpoints: [endpoint] });

    const before = resolveTarget("compat-ep1");
    expect(before && resolveTarget("compat-ep1")).not.toBeNull();
    expect(before?.cfg.activeLevel).toBe("low");

    if (!before) throw new Error("expected a target");
    await persistActiveLevel(before, "xhigh");

    const after = resolveTarget("compat-ep1");
    expect(after?.cfg.activeLevel).toBe("xhigh");
  });

  it("returns null for a model id with no matching custom endpoint", async () => {
    await usePreferencesStore.getState().init();
    usePreferencesStore.setState({ customEndpoints: [] });
    expect(resolveTarget("openai-compatible-custom")).toBeNull();
  });
});
