import type { ToolContext } from "../tools/context";

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateText: generateTextMock,
  stepCountIs: (n: number) => ({ type: "stepCount", n }),
}));
vi.mock("../tools/atlassianExplore", () => ({
  buildAtlassianExploreTools: () => ({}),
}));
vi.mock("../tools/githubExplore", () => ({
  buildGithubExploreTools: () => ({}),
}));
vi.mock("../tools/fs", () => ({ buildFsTools: () => ({}) }));
vi.mock("../tools/search", () => ({ buildSearchTools: () => ({}) }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSubagent, type SubagentStep } from "./runSubagent";

function makeContext(): ToolContext {
  return {
    getCwd: () => null,
    getWorkspaceRoot: () => null,
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

// Mirrors what the real `generateText` does: invoke `onStepFinish` once per
// step (in order) before resolving with the full `steps` array. Tests that
// only care about the final result can pass steps with no toolCalls.
function mockGenerateText(
  // biome-ignore lint/suspicious/noExplicitAny: test double for AI SDK steps
  steps: any[],
  text = "done",
) {
  generateTextMock.mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: test double for AI SDK config
    async (config: any) => {
      for (const step of steps) config.onStepFinish?.(step);
      return { text, steps };
    },
  );
}

beforeEach(() => {
  generateTextMock.mockReset();
  mockGenerateText([{ stepNumber: 0, toolCalls: [], toolResults: [] }]);
});

describe("runSubagent", () => {
  // Reproduces: "Error: Unknown model: compat-db5061e3" reported when the
  // Impact Analysis Agent (using a custom OpenAI-compatible endpoint as its
  // model) calls run_subagent → atlassian-explorer. The subagent should
  // resolve the SAME model the parent is using, including custom endpoints
  // — not just models in the static MODELS catalog.
  it("resolves a custom OpenAI-compatible endpoint model id instead of throwing Unknown model", async () => {
    await expect(
      runSubagent({
        type: "atlassian-explorer",
        prompt: "find jira tickets related to the login flow",
        keys: {} as never,
        modelId: "compat-db5061e3",
        toolContext: makeContext(),
        customEndpoints: [
          {
            id: "db5061e3",
            name: "My local model",
            baseURL: "http://localhost:1234/v1",
            modelId: "qwen2.5-coder",
            contextLimit: 128_000,
          },
        ],
      } as never),
    ).resolves.toBeDefined();

    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("captures a step trace (tool name, input, output, duration) instead of discarding it", async () => {
    mockGenerateText([
      {
        stepNumber: 0,
        toolCalls: [
          { toolCallId: "c1", toolName: "grep", input: { pattern: "foo" } },
        ],
        toolResults: [
          { toolCallId: "c1", toolName: "grep", output: { hits: [] } },
        ],
      },
    ]);

    const r = await runSubagent({
      type: "explore",
      prompt: "find foo",
      keys: { openai: "test-key" } as never,
      modelId: "gpt-5.6",
      toolContext: makeContext(),
    } as never);

    expect(r.steps).toEqual([
      {
        toolName: "grep",
        input: { pattern: "foo" },
        output: { hits: [] },
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("truncates step input/output that would otherwise bloat the persisted trace", async () => {
    const huge = "x".repeat(10_000);
    mockGenerateText([
      {
        stepNumber: 0,
        toolCalls: [
          { toolCallId: "c1", toolName: "read_file", input: { path: huge } },
        ],
        toolResults: [
          {
            toolCallId: "c1",
            toolName: "read_file",
            output: { content: huge },
          },
        ],
      },
    ]);

    const r = await runSubagent({
      type: "explore",
      prompt: "read a huge file",
      keys: { openai: "test-key" } as never,
      modelId: "gpt-5.6",
      toolContext: makeContext(),
    } as never);

    const [step] = r.steps;
    expect(JSON.stringify(step.input).length).toBeLessThan(5_000);
    expect(JSON.stringify(step.output).length).toBeLessThan(5_000);
  });

  it("replaces a non-JSON-serializable output (circular reference) instead of passing it through unsafe", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    mockGenerateText([
      {
        stepNumber: 0,
        toolCalls: [
          { toolCallId: "c1", toolName: "grep", input: { pattern: "a" } },
        ],
        toolResults: [
          { toolCallId: "c1", toolName: "grep", output: circular },
        ],
      },
    ]);

    const r = await runSubagent({
      type: "explore",
      prompt: "find foo",
      keys: { openai: "test-key" } as never,
      modelId: "gpt-5.6",
      toolContext: makeContext(),
    } as never);

    // Must not throw when the persisted trace is later JSON.stringify'd for
    // the session file, and must not silently keep the untruncated original.
    expect(() => JSON.stringify(r.steps)).not.toThrow();
    const [step] = r.steps;
    expect(step.output).not.toBe(circular);
    expect(step.output).toEqual(
      expect.objectContaining({ truncated: true }),
    );
  });

  it("matches each tool call to its own result when a step makes several calls", async () => {
    mockGenerateText([
      {
        stepNumber: 0,
        toolCalls: [
          { toolCallId: "c1", toolName: "grep", input: { pattern: "a" } },
          { toolCallId: "c2", toolName: "glob", input: { pattern: "b" } },
        ],
        toolResults: [
          { toolCallId: "c2", toolName: "glob", output: { matches: [] } },
          { toolCallId: "c1", toolName: "grep", output: { hits: [] } },
        ],
      },
    ]);

    const r = await runSubagent({
      type: "explore",
      prompt: "search two ways",
      keys: { openai: "test-key" } as never,
      modelId: "gpt-5.6",
      toolContext: makeContext(),
    } as never);

    expect(r.steps).toEqual([
      expect.objectContaining({
        toolName: "grep",
        output: { hits: [] },
      }),
      expect.objectContaining({
        toolName: "glob",
        output: { matches: [] },
      }),
    ]);
  });

  it("emits onStepTrace live, once per tool call, matching the final steps exactly", async () => {
    mockGenerateText([
      {
        stepNumber: 0,
        toolCalls: [
          { toolCallId: "c1", toolName: "grep", input: { pattern: "a" } },
        ],
        toolResults: [
          { toolCallId: "c1", toolName: "grep", output: { hits: [] } },
        ],
      },
      {
        stepNumber: 1,
        toolCalls: [
          { toolCallId: "c2", toolName: "read_file", input: { path: "x" } },
        ],
        toolResults: [
          { toolCallId: "c2", toolName: "read_file", output: { content: "y" } },
        ],
      },
    ]);

    const seen: unknown[] = [];
    const r = await runSubagent({
      type: "explore",
      prompt: "search then read",
      keys: { openai: "test-key" } as never,
      modelId: "gpt-5.6",
      toolContext: makeContext(),
      onStepTrace: (step: SubagentStep) => seen.push(step),
    } as never);

    // Live emission happened for both steps, in order, before the promise
    // resolved — and it's the exact same data as the final persisted trace,
    // so a live view handing off to the persisted one has nothing to
    // duplicate or lose.
    expect(seen).toEqual(r.steps);
    expect(seen).toHaveLength(2);
  });
});
