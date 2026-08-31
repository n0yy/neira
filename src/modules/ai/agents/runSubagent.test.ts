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
import { runSubagent } from "./runSubagent";

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

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({ text: "done", steps: [{}] });
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
    generateTextMock.mockResolvedValue({
      text: "done",
      steps: [
        {
          stepNumber: 0,
          toolCalls: [
            { toolCallId: "c1", toolName: "grep", input: { pattern: "foo" } },
          ],
          toolResults: [
            { toolCallId: "c1", toolName: "grep", output: { hits: [] } },
          ],
        },
      ],
    });

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
    generateTextMock.mockResolvedValue({
      text: "done",
      steps: [
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
      ],
    });

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

  it("matches each tool call to its own result when a step makes several calls", async () => {
    generateTextMock.mockResolvedValue({
      text: "done",
      steps: [
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
      ],
    });

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
});
