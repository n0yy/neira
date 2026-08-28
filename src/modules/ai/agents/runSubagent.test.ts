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
});
