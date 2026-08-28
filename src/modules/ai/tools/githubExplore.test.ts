import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const getGithubTokenMock = vi.hoisted(() => vi.fn());
const searchCodeMock = vi.hoisted(() => vi.fn());
const searchIssuesAndPrsMock = vi.hoisted(() => vi.fn());
const getFileContentsMock = vi.hoisted(() => vi.fn());
let selectedRepos: string[] = [];

vi.mock("@/modules/integrations/keyring", () => ({
  getGithubToken: getGithubTokenMock,
}));
vi.mock("@/modules/integrations/github", () => ({
  searchCode: searchCodeMock,
  searchIssuesAndPrs: searchIssuesAndPrsMock,
  getFileContents: getFileContentsMock,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ githubSelectedRepos: selectedRepos }),
  },
}));

import { buildGithubExploreTools } from "./githubExplore";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

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

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function runTool(
  name: keyof ReturnType<typeof buildGithubExploreTools>,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildGithubExploreTools(makeContext())[name].execute;
  if (!execute) throw new Error(`${name} has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedRepos = [];
});

describe("github_search_code", () => {
  it("errors without calling the API when GitHub isn't connected", async () => {
    getGithubTokenMock.mockResolvedValue(null);

    const r = await runTool("github_search_code", { query: "login" });

    expect(r.error).toMatch(/not connected/i);
    expect(searchCodeMock).not.toHaveBeenCalled();
  });

  it("errors without calling the API when no repos are selected", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = [];

    const r = await runTool("github_search_code", { query: "login" });

    expect(r.error).toMatch(/no github repos/i);
    expect(searchCodeMock).not.toHaveBeenCalled();
  });

  it("passes the token and selected repos through on success", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = ["octocat/hello"];
    searchCodeMock.mockResolvedValue([{ repo: "octocat/hello", path: "a.ts" }]);

    const r = await runTool("github_search_code", { query: "login" });

    expect(searchCodeMock).toHaveBeenCalledWith("tok", "login", [
      "octocat/hello",
    ]);
    expect(r.hits).toEqual([{ repo: "octocat/hello", path: "a.ts" }]);
  });

  it("returns an error result instead of throwing when the API call fails", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = ["octocat/hello"];
    searchCodeMock.mockRejectedValue(new Error("rate limited"));

    const r = await runTool("github_search_code", { query: "login" });

    expect(r.error).toContain("rate limited");
  });
});

describe("github_search_issues_and_prs", () => {
  it("errors when not connected", async () => {
    getGithubTokenMock.mockResolvedValue(null);

    const r = await runTool("github_search_issues_and_prs", { query: "bug" });

    expect(r.error).toMatch(/not connected/i);
  });

  it("passes through on success", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = ["octocat/hello"];
    searchIssuesAndPrsMock.mockResolvedValue([{ number: 1, title: "Bug" }]);

    const r = await runTool("github_search_issues_and_prs", { query: "bug" });

    expect(searchIssuesAndPrsMock).toHaveBeenCalledWith("tok", "bug", [
      "octocat/hello",
    ]);
    expect(r.hits).toEqual([{ number: 1, title: "Bug" }]);
  });
});

describe("github_get_file_contents", () => {
  it("errors when the requested repo isn't in the connected scope", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = ["octocat/hello"];

    const r = await runTool("github_get_file_contents", {
      repo: "octocat/other",
      path: "a.ts",
    });

    expect(r.error).toMatch(/not one of the connected repos/i);
    expect(getFileContentsMock).not.toHaveBeenCalled();
  });

  it("fetches file contents for a repo within scope", async () => {
    getGithubTokenMock.mockResolvedValue("tok");
    selectedRepos = ["octocat/hello"];
    getFileContentsMock.mockResolvedValue({
      content: "export const x = 1;",
      truncated: false,
    });

    const r = await runTool("github_get_file_contents", {
      repo: "octocat/hello",
      path: "src/a.ts",
    });

    expect(getFileContentsMock).toHaveBeenCalledWith(
      "tok",
      "octocat/hello",
      "src/a.ts",
      undefined,
    );
    expect(r).toEqual({ content: "export const x = 1;", truncated: false });
  });
});
