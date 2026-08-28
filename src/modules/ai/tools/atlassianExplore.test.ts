import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const getAtlassianTokenMock = vi.hoisted(() => vi.fn());
const searchJqlMock = vi.hoisted(() => vi.fn());
const searchCqlMock = vi.hoisted(() => vi.fn());
const getJiraIssueMock = vi.hoisted(() => vi.fn());
const getConfluencePageMock = vi.hoisted(() => vi.fn());

let prefs = {
  atlassianSite: "",
  atlassianEmail: "",
  atlassianJiraEnabled: true,
  atlassianConfluenceEnabled: true,
  atlassianSelectedProjects: [] as string[],
  atlassianSelectedSpaces: [] as string[],
};

vi.mock("@/modules/integrations/keyring", () => ({
  getAtlassianToken: getAtlassianTokenMock,
}));
vi.mock("@/modules/integrations/atlassian", () => ({
  searchJql: searchJqlMock,
  searchCql: searchCqlMock,
  getJiraIssue: getJiraIssueMock,
  getConfluencePage: getConfluencePageMock,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => prefs },
}));

import { buildAtlassianExploreTools } from "./atlassianExplore";

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
  name: keyof ReturnType<typeof buildAtlassianExploreTools>,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildAtlassianExploreTools(makeContext())[name].execute;
  if (!execute) throw new Error(`${name} has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => {
  vi.clearAllMocks();
  prefs = {
    atlassianSite: "acme.atlassian.net",
    atlassianEmail: "a@acme.com",
    atlassianJiraEnabled: true,
    atlassianConfluenceEnabled: true,
    atlassianSelectedProjects: [],
    atlassianSelectedSpaces: [],
  };
});

describe("atlassian_search_jql", () => {
  it("errors when not connected", async () => {
    getAtlassianTokenMock.mockResolvedValue(null);

    const r = await runTool("atlassian_search_jql", { jql: "text ~ login" });

    expect(r.error).toMatch(/not connected/i);
    expect(searchJqlMock).not.toHaveBeenCalled();
  });

  it("errors when Jira is disabled", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianJiraEnabled = false;

    const r = await runTool("atlassian_search_jql", { jql: "text ~ login" });

    expect(r.error).toMatch(/jira is not enabled/i);
    expect(searchJqlMock).not.toHaveBeenCalled();
  });

  it("errors when no projects are selected", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");

    const r = await runTool("atlassian_search_jql", { jql: "text ~ login" });

    expect(r.error).toMatch(/no jira projects/i);
    expect(searchJqlMock).not.toHaveBeenCalled();
  });

  it("passes token, jql, and selected projects through on success", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG"];
    searchJqlMock.mockResolvedValue([{ key: "ENG-1" }]);

    const r = await runTool("atlassian_search_jql", { jql: "text ~ login" });

    expect(searchJqlMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      "text ~ login",
      ["ENG"],
    );
    expect(r.hits).toEqual([{ key: "ENG-1" }]);
  });
});

describe("atlassian_search_cql", () => {
  it("errors when Confluence is disabled", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianConfluenceEnabled = false;

    const r = await runTool("atlassian_search_cql", { cql: "text ~ login" });

    expect(r.error).toMatch(/confluence is not enabled/i);
    expect(searchCqlMock).not.toHaveBeenCalled();
  });

  it("errors when no spaces are selected", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");

    const r = await runTool("atlassian_search_cql", { cql: "text ~ login" });

    expect(r.error).toMatch(/no confluence spaces/i);
  });

  it("passes through on success", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    searchCqlMock.mockResolvedValue([{ id: "1", title: "Login Flow" }]);

    const r = await runTool("atlassian_search_cql", { cql: "text ~ login" });

    expect(searchCqlMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      "text ~ login",
      ["ENG"],
    );
    expect(r.hits).toEqual([{ id: "1", title: "Login Flow" }]);
  });
});

describe("atlassian_get_jira_issue", () => {
  it("errors when the issue's project isn't in the connected scope", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG"];

    const r = await runTool("atlassian_get_jira_issue", { key: "DES-42" });

    expect(r.error).toMatch(/not in a connected project/i);
    expect(getJiraIssueMock).not.toHaveBeenCalled();
  });

  it("fetches the issue when its project is in scope", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG"];
    getJiraIssueMock.mockResolvedValue({ key: "ENG-1", summary: "Bug" });

    const r = await runTool("atlassian_get_jira_issue", { key: "ENG-1" });

    expect(getJiraIssueMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      "ENG-1",
    );
    expect(r).toEqual({ key: "ENG-1", summary: "Bug" });
  });
});

describe("atlassian_get_confluence_page", () => {
  it("errors when the fetched page's space isn't in the connected scope", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    getConfluencePageMock.mockResolvedValue({
      id: "1",
      title: "Secret",
      spaceKey: "HR",
      content: "...",
      url: "...",
    });

    const r = await runTool("atlassian_get_confluence_page", { id: "1" });

    expect(r.error).toMatch(/not connected/i);
  });

  it("returns the page when its space is in scope", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    const page = {
      id: "1",
      title: "Login Flow",
      spaceKey: "ENG",
      content: "...",
      url: "...",
    };
    getConfluencePageMock.mockResolvedValue(page);

    const r = await runTool("atlassian_get_confluence_page", { id: "1" });

    expect(r).toEqual(page);
  });
});
