import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const getAtlassianTokenMock = vi.hoisted(() => vi.fn());
const upsertConfluencePageMock = vi.hoisted(() => vi.fn());
const upsertJiraIssueMock = vi.hoisted(() => vi.fn());

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
vi.mock("@/modules/integrations/atlassian", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/integrations/atlassian")>();
  return {
    ...actual,
    upsertConfluencePage: upsertConfluencePageMock,
    upsertJiraIssue: upsertJiraIssueMock,
  };
});
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => prefs },
}));

import { buildAtlassianPublishTools } from "./atlassianPublish";

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
    readCache: new Map(),
    getSessionId: () => "session",
    getPermissionMode: () => "manual",
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function runTool(
  name: keyof ReturnType<typeof buildAtlassianPublishTools>,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildAtlassianPublishTools(makeContext())[name].execute;
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

describe("push_confluence", () => {
  it("errors when not connected", async () => {
    getAtlassianTokenMock.mockResolvedValue(null);
    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "hi",
    });
    expect(r.error).toMatch(/not connected/i);
    expect(upsertConfluencePageMock).not.toHaveBeenCalled();
  });

  it("errors when Confluence is disabled", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianConfluenceEnabled = false;
    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "hi",
    });
    expect(r.error).toMatch(/confluence is not enabled/i);
  });

  it("errors when no space is selected", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "hi",
    });
    expect(r.error).toMatch(/no confluence spaces? are selected/i);
    expect(upsertConfluencePageMock).not.toHaveBeenCalled();
  });

  it("auto-uses the single selected space when spaceKey is omitted", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    upsertConfluencePageMock.mockResolvedValue({
      id: "1",
      url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1",
      action: "created",
    });

    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "hi",
    });

    expect(upsertConfluencePageMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      { spaceKey: "ENG", kind: "spec", title: "my-feature", content: "<p>hi</p>" },
    );
    expect(r.action).toBe("created");
  });

  it("converts plain-text content to escaped Confluence storage format before writing", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    upsertConfluencePageMock.mockResolvedValue({ id: "1", url: "x", action: "created" });

    await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "A & B < C\n\nSecond paragraph",
    });

    const [, params] = upsertConfluencePageMock.mock.calls[0];
    expect(params.content).toBe(
      "<p>A &amp; B &lt; C</p><p>Second paragraph</p>",
    );
  });

  it("errors when multiple spaces are selected and spaceKey is omitted", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG", "DES"];
    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "my-feature",
      content: "hi",
    });
    expect(r.error).toMatch(/multiple confluence spaces/i);
    expect(upsertConfluencePageMock).not.toHaveBeenCalled();
  });

  it("uses the explicit spaceKey when given and valid", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG", "DES"];
    upsertConfluencePageMock.mockResolvedValue({
      id: "1",
      url: "x",
      action: "updated",
    });

    await runTool("push_confluence", {
      kind: "adr",
      title: "ADR-0006: foo",
      content: "hi",
      spaceKey: "DES",
    });

    expect(upsertConfluencePageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ spaceKey: "DES", kind: "adr" }),
    );
  });

  it("rejects an explicit spaceKey outside the selected list", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedSpaces = ["ENG"];
    const r = await runTool("push_confluence", {
      kind: "spec",
      title: "x",
      content: "hi",
      spaceKey: "HR",
    });
    expect(r.error).toMatch(/not a connected confluence space/i);
    expect(upsertConfluencePageMock).not.toHaveBeenCalled();
  });
});

describe("push_jira (task)", () => {
  it("errors when Jira is disabled", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianJiraEnabled = false;
    const r = await runTool("push_jira", {
      kind: "task",
      summary: "[slug] ticket",
      description: "body",
      epicKey: "ENG-1",
    });
    expect(r.error).toMatch(/jira is not enabled/i);
  });

  it("auto-uses the single selected project and forwards epicKey/blockedByKey", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG"];
    upsertJiraIssueMock.mockResolvedValue({
      key: "ENG-5",
      url: "https://acme.atlassian.net/browse/ENG-5",
      action: "created",
    });

    const r = await runTool("push_jira", {
      kind: "task",
      summary: "[slug] ticket",
      description: "body",
      epicKey: "ENG-1",
      blockedByKey: "ENG-4",
    });

    expect(upsertJiraIssueMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      {
        kind: "task",
        projectKey: "ENG",
        summary: "[slug] ticket",
        description: "body",
        epicKey: "ENG-1",
        blockedByKey: "ENG-4",
      },
    );
    expect(r.action).toBe("created");
  });

  it("errors when multiple projects are selected and projectKey is omitted", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG", "DES"];
    const r = await runTool("push_jira", {
      kind: "task",
      summary: "[slug] ticket",
      description: "body",
      epicKey: "ENG-1",
    });
    expect(r.error).toMatch(/multiple jira projects/i);
    expect(upsertJiraIssueMock).not.toHaveBeenCalled();
  });
});

describe("push_jira (epic)", () => {
  it("forwards kind: epic without epicKey/blockedByKey", async () => {
    getAtlassianTokenMock.mockResolvedValue("tok");
    prefs.atlassianSelectedProjects = ["ENG"];
    upsertJiraIssueMock.mockResolvedValue({
      key: "ENG-1",
      url: "https://acme.atlassian.net/browse/ENG-1",
      action: "created",
    });

    const r = await runTool("push_jira", {
      kind: "epic",
      summary: "my-feature",
      description: "Spec: https://acme.atlassian.net/wiki/spaces/ENG/x",
    });

    expect(upsertJiraIssueMock).toHaveBeenCalledWith(
      { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" },
      {
        kind: "epic",
        projectKey: "ENG",
        summary: "my-feature",
        description: "Spec: https://acme.atlassian.net/wiki/spaces/ENG/x",
      },
    );
    expect(r.action).toBe("created");
  });
});
