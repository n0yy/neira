import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const runSubagentMock = vi.hoisted(() => vi.fn());

vi.mock("../agents/runSubagent", () => ({ runSubagent: runSubagentMock }));
vi.mock("../store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      apiKeys: {},
      selectedModelId: "compat-db5061e3",
      customEndpointKeys: { db5061e3: "ep-key" },
      patchAgentMeta: vi.fn(),
    }),
  },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({
      lmstudioBaseURL: "http://localhost:1234/v1",
      lmstudioModelId: "",
      mlxBaseURL: "http://127.0.0.1:8080/v1",
      mlxModelId: "",
      ollamaBaseURL: "http://localhost:11434/v1",
      ollamaModelId: "",
      openaiCompatibleBaseURL: "",
      openaiCompatibleModelId: "",
      openrouterModelId: "",
      customEndpoints: [
        {
          id: "db5061e3",
          name: "My endpoint",
          baseURL: "http://localhost:1234/v1",
          modelId: "qwen2.5-coder",
          contextLimit: 128_000,
        },
      ],
    }),
  },
}));

import { buildSubagentTools } from "./subagent";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(input: Record<string, unknown>): Promise<Result> {
  const execute = buildSubagentTools(makeContext()).run_subagent.execute;
  if (!execute) throw new Error("run_subagent has no execute");
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => vi.clearAllMocks());

describe("run_subagent", () => {
  it("maps the subagent result fields on success", async () => {
    runSubagentMock.mockResolvedValue({
      summary: "done",
      stepCount: 4,
      durationMs: 1200,
      steps: [
        { toolName: "grep", input: { pattern: "x" }, output: { hits: [] }, durationMs: 50 },
      ],
    });
    const r = await run({
      type: "reviewer",
      prompt: "review it",
      description: "card",
    });
    expect(r).toEqual({
      type: "reviewer",
      description: "card",
      summary: "done",
      stepCount: 4,
      durationMs: 1200,
      steps: [
        { toolName: "grep", input: { pattern: "x" }, output: { hits: [] }, durationMs: 50 },
      ],
    });
  });

  it("returns an error result instead of throwing when the subagent fails", async () => {
    runSubagentMock.mockRejectedValue(new Error("boom"));
    const r = await run({ type: "reviewer", prompt: "review it" });
    expect(r.type).toBe("reviewer");
    expect(r.error).toContain("boom");
  });

  it("forwards the parent's selected model id and local/custom-endpoint config to runSubagent", async () => {
    runSubagentMock.mockResolvedValue({
      summary: "done",
      stepCount: 1,
      durationMs: 10,
    });

    await run({ type: "atlassian-explorer", prompt: "find related tickets" });

    expect(runSubagentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "compat-db5061e3",
        customEndpoints: [
          expect.objectContaining({ id: "db5061e3", modelId: "qwen2.5-coder" }),
        ],
        customEndpointKeys: { db5061e3: "ep-key" },
      }),
    );
  });
});
