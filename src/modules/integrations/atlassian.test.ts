import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/proxyFetch", () => ({
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "@/modules/ai/lib/proxyFetch";
import {
  AtlassianApiError,
  createConfluencePage,
  createJiraBlockedByLink,
  createJiraIssue,
  filterAtlassianItems,
  findConfluencePageByTitle,
  findJiraIssueBySummary,
  getConfluencePage,
  getDefaultJiraIssueType,
  getJiraIssueTypeByName,
  getOrCreateConfluenceParentPage,
  getJiraIssue,
  listConfluenceSpaces,
  listJiraProjects,
  normalizeAtlassianSite,
  plainTextToConfluenceStorage,
  searchCql,
  searchJql,
  updateConfluencePage,
  updateJiraIssue,
  upsertConfluencePage,
  upsertJiraIssue,
  validateAtlassianCredentials,
} from "./atlassian";

const fetchMock = vi.mocked(proxyFetch);

afterEach(() => {
  fetchMock.mockReset();
});

const creds = { site: "acme.atlassian.net", email: "a@acme.com", token: "tok" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("normalizeAtlassianSite", () => {
  it("passes through a full atlassian.net host", () => {
    expect(normalizeAtlassianSite("acme.atlassian.net")).toBe(
      "acme.atlassian.net",
    );
  });

  it("strips protocol and trailing slash", () => {
    expect(normalizeAtlassianSite("https://acme.atlassian.net/")).toBe(
      "acme.atlassian.net",
    );
  });

  it("expands a bare site name to atlassian.net", () => {
    expect(normalizeAtlassianSite("acme")).toBe("acme.atlassian.net");
  });

  it("drops a path suffix pasted along with the URL", () => {
    expect(
      normalizeAtlassianSite("https://acme.atlassian.net/jira/projects"),
    ).toBe("acme.atlassian.net");
    expect(normalizeAtlassianSite("acme.atlassian.net/wiki/spaces/ENG")).toBe(
      "acme.atlassian.net",
    );
  });
});

describe("validateAtlassianCredentials", () => {
  it("rejects when neither product is enabled", async () => {
    await expect(
      validateAtlassianCredentials(creds, { jira: false, confluence: false }),
    ).rejects.toThrow(/enable jira/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates against the Jira endpoint when Jira is enabled, sending Basic auth via the Rust HTTP proxy", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ accountId: "acc1", displayName: "Ada" }),
    );

    const user = await validateAtlassianCredentials(creds, {
      jira: true,
      confluence: false,
    });

    expect(user).toEqual({ accountId: "acc1", displayName: "Ada" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/myself");
    if (!init) throw new Error("proxyFetch was called without an init object");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("a@acme.com:tok")}`,
    );
  });

  it("validates against the Confluence endpoint when only Confluence is enabled", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ accountId: "acc1", displayName: "Ada" }),
    );

    await validateAtlassianCredentials(creds, {
      jira: false,
      confluence: true,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/wiki/rest/api/user/current");
  });

  it("checks both endpoints when both products are enabled, and fails if either does", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ accountId: "acc1", displayName: "Ada" }),
    );

    await validateAtlassianCredentials(creds, { jira: true, confluence: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain("https://acme.atlassian.net/rest/api/3/myself");
    expect(urls).toContain(
      "https://acme.atlassian.net/wiki/rest/api/user/current",
    );

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ accountId: "acc1", displayName: "Ada" }),
      )
      .mockResolvedValueOnce(jsonResponse({}, false, 403));

    await expect(
      validateAtlassianCredentials(creds, { jira: true, confluence: true }),
    ).rejects.toThrow(AtlassianApiError);
  });

  it("throws a friendly error on 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));

    await expect(
      validateAtlassianCredentials(creds, { jira: true, confluence: false }),
    ).rejects.toThrow(AtlassianApiError);
    await expect(
      validateAtlassianCredentials(creds, { jira: true, confluence: false }),
    ).rejects.toThrow(/invalid email or api token/i);
  });
});

describe("listJiraProjects", () => {
  it("stops once isLast is true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        values: [{ id: "1", key: "ENG", name: "Engineering" }],
        isLast: true,
      }),
    );

    const result = await listJiraProjects(creds);

    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([{ key: "ENG", name: "Engineering" }]);
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 403));

    await expect(listJiraProjects(creds)).rejects.toThrow(AtlassianApiError);
  });
});

describe("listConfluenceSpaces", () => {
  it("stops once a short page is returned", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ id: 10, key: "ENG", name: "Engineering Docs" }],
        size: 1,
      }),
    );

    const result = await listConfluenceSpaces(creds);

    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([{ key: "ENG", name: "Engineering Docs" }]);
  });
});

describe("searchJql", () => {
  it("returns an empty array without calling fetch when no projects are selected", async () => {
    const r = await searchJql(creds, "text ~ login", []);
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to /rest/api/3/search/jql with the query scoped to selected projects", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issues: [
          {
            key: "ENG-1",
            fields: { summary: "Login fails", status: { name: "Open" } },
          },
        ],
      }),
    );

    const hits = await searchJql(creds, 'text ~ "login"', ["ENG", "DES"]);

    expect(hits).toEqual([
      {
        key: "ENG-1",
        summary: "Login fails",
        status: "Open",
        url: "https://acme.atlassian.net/browse/ENG-1",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.jql).toBe('(text ~ "login") AND project in ("ENG","DES")');
    expect(body.maxResults).toBe(25);
  });

  it("throws an AtlassianApiError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 400));

    await expect(searchJql(creds, "x", ["ENG"])).rejects.toThrow(
      AtlassianApiError,
    );
  });

  it("inserts the project clause before a trailing ORDER BY instead of wrapping it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

    await searchJql(creds, "status = Open order by updated DESC", ["ENG"]);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.jql).toBe(
      '(status = Open) AND project in ("ENG") order by updated DESC',
    );
  });
});

describe("searchCql", () => {
  it("returns an empty array without calling fetch when no spaces are selected", async () => {
    const r = await searchCql(creds, "text ~ login", []);
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs /wiki/rest/api/search with cql scoped to selected spaces, stripping highlight markers", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            content: { id: "123", title: "Login Flow" },
            excerpt: "The @@@hl@@@login@@@endhl@@@ flow works like...",
            url: "/spaces/ENG/pages/123/Login+Flow",
          },
        ],
      }),
    );

    const hits = await searchCql(creds, 'text ~ "login"', ["ENG"]);

    expect(hits).toEqual([
      {
        id: "123",
        title: "Login Flow",
        excerpt: "The login flow works like...",
        url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Login+Flow",
      },
    ]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent('(text ~ "login") AND space in ("ENG")'),
    );
  });
});

describe("getJiraIssue", () => {
  it("converts the ADF description to plain text", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        key: "ENG-1",
        fields: {
          summary: "Login fails",
          status: { name: "Open" },
          description: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Steps to reproduce:" }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Click login twice." }],
              },
            ],
          },
        },
      }),
    );

    const issue = await getJiraIssue(creds, "ENG-1");

    expect(issue.description).toBe(
      "Steps to reproduce:\nClick login twice.",
    );
    expect(issue.url).toBe("https://acme.atlassian.net/browse/ENG-1");
  });

  it("throws a friendly error on 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 404));

    await expect(getJiraIssue(creds, "ENG-999")).rejects.toThrow(
      /issue not found/i,
    );
  });
});

describe("getConfluencePage", () => {
  it("strips storage-format markup down to plain text and includes the space key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "123",
        title: "Login Flow",
        space: { key: "ENG" },
        body: {
          storage: {
            value: "<p>The login flow &amp; retry logic.</p>",
          },
        },
        _links: { webui: "/spaces/ENG/pages/123/Login+Flow" },
      }),
    );

    const page = await getConfluencePage(creds, "123");

    expect(page).toEqual({
      id: "123",
      title: "Login Flow",
      spaceKey: "ENG",
      content: "The login flow & retry logic.",
      url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Login+Flow",
    });
  });

  it("throws a friendly error on 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 404));

    await expect(getConfluencePage(creds, "999")).rejects.toThrow(
      /page not found/i,
    );
  });
});

describe("filterAtlassianItems", () => {
  const items = [
    { key: "ENG", name: "Engineering" },
    { key: "DES", name: "Design Docs" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterAtlassianItems(items, "")).toEqual(items);
  });

  it("matches case-insensitively against key or name", () => {
    expect(filterAtlassianItems(items, "eng")).toEqual([items[0]]);
    expect(filterAtlassianItems(items, "docs")).toEqual([items[1]]);
  });

  it("returns nothing when no item matches", () => {
    expect(filterAtlassianItems(items, "nope")).toEqual([]);
  });
});

describe("plainTextToConfluenceStorage", () => {
  it("wraps a single block in one <p>, escaping & < >", () => {
    expect(plainTextToConfluenceStorage("A & B < C > D")).toBe(
      "<p>A &amp; B &lt; C &gt; D</p>",
    );
  });

  it("splits blank-line-separated blocks into separate paragraphs", () => {
    expect(plainTextToConfluenceStorage("First\n\nSecond")).toBe(
      "<p>First</p><p>Second</p>",
    );
  });

  it("converts a single newline within a block to <br/>", () => {
    expect(plainTextToConfluenceStorage("line one\nline two")).toBe(
      "<p>line one<br/>line two</p>",
    );
  });
});

describe("findConfluencePageByTitle", () => {
  it("returns null when the search has no exact-title match", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    expect(await findConfluencePageByTitle(creds, "ENG", "Specs")).toBeNull();
  });

  it("returns null when a hit's title only partially matches", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { content: { id: "1", title: "Specs Archive" }, url: "/x" },
        ],
      }),
    );
    expect(await findConfluencePageByTitle(creds, "ENG", "Specs")).toBeNull();
  });

  it("returns the id of the exact-title match", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ content: { id: "42", title: "Specs" }, url: "/x" }],
      }),
    );
    expect(await findConfluencePageByTitle(creds, "ENG", "Specs")).toEqual({
      id: "42",
    });
  });
});

describe("createConfluencePage", () => {
  it("POSTs to /wiki/rest/api/content with an ancestors entry when parentId is given", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "99", _links: { webui: "/spaces/ENG/pages/99" } }),
    );

    const result = await createConfluencePage(creds, {
      spaceKey: "ENG",
      title: "my-feature",
      content: "<p>hi</p>",
      parentId: "10",
    });

    expect(result).toEqual({
      id: "99",
      url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/99",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/wiki/rest/api/content");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.ancestors).toEqual([{ id: "10" }]);
    expect(body.space).toEqual({ key: "ENG" });
  });

  it("omits ancestors when no parentId is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "99", _links: {} }));
    await createConfluencePage(creds, {
      spaceKey: "ENG",
      title: "Specs",
      content: "",
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.ancestors).toBeUndefined();
  });
});

describe("updateConfluencePage", () => {
  it("fetches the current version, then PUTs with version + 1", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ version: { number: 3 } }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "99", _links: { webui: "/spaces/ENG/pages/99" } }),
      );

    const result = await updateConfluencePage(creds, {
      id: "99",
      title: "my-feature",
      content: "<p>updated</p>",
    });

    expect(result).toEqual({
      id: "99",
      url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/99",
    });
    const [, putInit] = fetchMock.mock.calls[1];
    expect(putInit?.method).toBe("PUT");
    const body = JSON.parse(putInit?.body as string);
    expect(body.version).toEqual({ number: 4 });
  });
});

describe("getOrCreateConfluenceParentPage", () => {
  it("reuses the existing parent page when one is found", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ content: { id: "7", title: "Specs" }, url: "/x" }],
      }),
    );
    const id = await getOrCreateConfluenceParentPage(creds, "ENG", "Specs");
    expect(id).toBe("7");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the parent page when none is found", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "8", _links: {} }));
    const id = await getOrCreateConfluenceParentPage(creds, "ENG", "ADRs");
    expect(id).toBe("8");
    const [, createInit] = fetchMock.mock.calls[1];
    expect(createInit?.method).toBe("POST");
  });
});

describe("upsertConfluencePage", () => {
  it("updates in place when a page with the exact title already exists", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ content: { id: "42", title: "my-feature" }, url: "/x" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ version: { number: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ id: "42", _links: {} }));

    const result = await upsertConfluencePage(creds, {
      spaceKey: "ENG",
      kind: "spec",
      title: "my-feature",
      content: "<p>hi</p>",
    });

    expect(result.action).toBe("updated");
    expect(result.id).toBe("42");
  });

  it("creates under the Specs/ADRs parent page when no existing page matches", async () => {
    fetchMock
      // search for the artifact's own title -> no match
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      // search for the "Specs" parent -> no match
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      // create the "Specs" parent
      .mockResolvedValueOnce(jsonResponse({ id: "10", _links: {} }))
      // create the artifact page itself
      .mockResolvedValueOnce(jsonResponse({ id: "11", _links: {} }));

    const result = await upsertConfluencePage(creds, {
      spaceKey: "ENG",
      kind: "spec",
      title: "my-feature",
      content: "<p>hi</p>",
    });

    expect(result.action).toBe("created");
    expect(result.id).toBe("11");
    const [, createInit] = fetchMock.mock.calls[3];
    const body = JSON.parse(createInit?.body as string);
    expect(body.ancestors).toEqual([{ id: "10" }]);
  });
});

describe("findJiraIssueBySummary", () => {
  it("returns null when no hit has an exact summary match", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issues: [{ key: "ENG-1", fields: { summary: "not it" } }],
      }),
    );
    expect(
      await findJiraIssueBySummary(creds, "ENG", "[slug] the ticket"),
    ).toBeNull();
  });

  it("returns the key of the exact-summary match", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issues: [
          { key: "ENG-2", fields: { summary: "[slug] the ticket" } },
        ],
      }),
    );
    expect(
      await findJiraIssueBySummary(creds, "ENG", "[slug] the ticket"),
    ).toEqual({ key: "ENG-2" });
  });

  it("scopes the JQL to the given issue type when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
    await findJiraIssueBySummary(creds, "ENG", "my-feature", "Epic");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.jql).toContain('issuetype = "Epic"');
  });

  it("omits the issue-type clause when none is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
    await findJiraIssueBySummary(creds, "ENG", "[slug] the ticket");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.jql).not.toContain("issuetype");
  });
});

describe("getDefaultJiraIssueType", () => {
  it("picks the first non-subtask issue type", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issueTypes: [
          { id: "10", name: "Subtask", subtask: true },
          { id: "11", name: "Task", subtask: false },
        ],
      }),
    );
    expect(await getDefaultJiraIssueType(creds, "ENG")).toEqual({
      id: "11",
      name: "Task",
    });
  });

  it("skips Epic even though it's a non-subtask type", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issueTypes: [
          { id: "12", name: "Epic", subtask: false },
          { id: "11", name: "Task", subtask: false },
        ],
      }),
    );
    expect(await getDefaultJiraIssueType(creds, "ENG")).toEqual({
      id: "11",
      name: "Task",
    });
  });

  it("throws when the project has no non-subtask issue types", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issueTypes: [] }));
    await expect(getDefaultJiraIssueType(creds, "ENG")).rejects.toThrow(
      AtlassianApiError,
    );
  });
});

describe("getJiraIssueTypeByName", () => {
  it("finds an issue type by exact name", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        issueTypes: [
          { id: "11", name: "Task", subtask: false },
          { id: "12", name: "Epic", subtask: false },
        ],
      }),
    );
    expect(await getJiraIssueTypeByName(creds, "ENG", "Epic")).toEqual({
      id: "12",
      name: "Epic",
    });
  });

  it("throws when no issue type matches the name", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ issueTypes: [{ id: "11", name: "Task", subtask: false }] }),
    );
    await expect(
      getJiraIssueTypeByName(creds, "ENG", "Epic"),
    ).rejects.toThrow(/no "Epic" issue type/i);
  });
});

describe("createJiraIssue", () => {
  it("resolves the default issue type, then POSTs the issue with an ADF description", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ issueTypes: [{ id: "11", name: "Task", subtask: false }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ key: "ENG-3" }));

    const result = await createJiraIssue(creds, {
      projectKey: "ENG",
      summary: "[slug] the ticket",
      description: "Blocked by: 01-foo",
    });

    expect(result).toEqual({
      key: "ENG-3",
      url: "https://acme.atlassian.net/browse/ENG-3",
    });
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init?.body as string);
    expect(body.fields.issuetype).toEqual({ id: "11" });
    expect(body.fields.description.type).toBe("doc");
    expect(body.fields.parent).toBeUndefined();
  });

  it("sets the parent field when parentKey is given, and skips the default-issue-type lookup when issueTypeId is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ key: "ENG-6" }));

    await createJiraIssue(creds, {
      projectKey: "ENG",
      summary: "[slug] child ticket",
      description: "body",
      issueTypeId: "11",
      parentKey: "ENG-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.fields.issuetype).toEqual({ id: "11" });
    expect(body.fields.parent).toEqual({ key: "ENG-1" });
  });

  it("splits the description into ADF paragraphs and hardBreaks instead of one flat text node", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ issueTypes: [{ id: "11", name: "Task", subtask: false }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ key: "ENG-3" }));

    await createJiraIssue(creds, {
      projectKey: "ENG",
      summary: "[slug] the ticket",
      description: "**What to build:** line one\nline two\n\n**Status:** draft",
    });

    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init?.body as string);
    expect(body.fields.description).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "**What to build:** line one" },
            { type: "hardBreak" },
            { type: "text", text: "line two" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "**Status:** draft" }],
        },
      ],
    });
  });
});

describe("updateJiraIssue", () => {
  it("PUTs the summary/description without a preceding GET", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await updateJiraIssue(creds, {
      key: "ENG-3",
      summary: "[slug] the ticket (revised)",
      description: "updated body",
    });
    expect(result).toEqual({
      key: "ENG-3",
      url: "https://acme.atlassian.net/browse/ENG-3",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("PUT");
  });
});

describe("createJiraBlockedByLink", () => {
  it("POSTs a Blocks-type link with the blocked issue inward", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await createJiraBlockedByLink(creds, {
      blockedKey: "ENG-4",
      blockerKey: "ENG-3",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/rest/api/3/issueLink");
    const body = JSON.parse(init?.body as string);
    expect(body.type).toEqual({ name: "Blocks" });
    expect(body.inwardIssue).toEqual({ key: "ENG-4" });
    expect(body.outwardIssue).toEqual({ key: "ENG-3" });
  });
});

describe("upsertJiraIssue", () => {
  it("creates a new issue and links it when blockedByKey is given", async () => {
    fetchMock
      // search -> no match
      .mockResolvedValueOnce(jsonResponse({ issues: [] }))
      // default issue type
      .mockResolvedValueOnce(
        jsonResponse({ issueTypes: [{ id: "11", name: "Task", subtask: false }] }),
      )
      // create
      .mockResolvedValueOnce(jsonResponse({ key: "ENG-5" }))
      // link
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await upsertJiraIssue(creds, {
      kind: "task",
      projectKey: "ENG",
      summary: "[slug] second ticket",
      description: "Blocked by: 01-foo",
      epicKey: "ENG-1",
      blockedByKey: "ENG-4",
    });

    expect(result.action).toBe("created");
    expect(result.key).toBe("ENG-5");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [linkUrl] = fetchMock.mock.calls[3];
    expect(linkUrl).toContain("/rest/api/3/issueLink");
    const [, createInit] = fetchMock.mock.calls[2];
    const createBody = JSON.parse(createInit?.body as string);
    expect(createBody.fields.parent).toEqual({ key: "ENG-1" });
  });

  it("updates in place when a matching summary already exists, without linking when no blockedByKey", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [{ key: "ENG-5", fields: { summary: "[slug] second ticket" } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await upsertJiraIssue(creds, {
      kind: "task",
      projectKey: "ENG",
      summary: "[slug] second ticket",
      description: "revised",
      epicKey: "ENG-1",
    });

    expect(result.action).toBe("updated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("upsertJiraIssue (epic)", () => {
  it("scopes the create-vs-update search to issuetype = Epic, and resolves the Epic type by name on create", async () => {
    fetchMock
      // search -> no match
      .mockResolvedValueOnce(jsonResponse({ issues: [] }))
      // issue-type-by-name lookup
      .mockResolvedValueOnce(
        jsonResponse({
          issueTypes: [
            { id: "10", name: "Task", subtask: false },
            { id: "12", name: "Epic", subtask: false },
          ],
        }),
      )
      // create
      .mockResolvedValueOnce(jsonResponse({ key: "ENG-1" }));

    const result = await upsertJiraIssue(creds, {
      kind: "epic",
      projectKey: "ENG",
      summary: "my-feature",
      description: "Spec: https://acme.atlassian.net/wiki/spaces/ENG/x",
    });

    expect(result.action).toBe("created");
    expect(result.key).toBe("ENG-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [searchUrl] = fetchMock.mock.calls[0];
    expect(searchUrl).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
    const [, searchInit] = fetchMock.mock.calls[0];
    const searchBody = JSON.parse(searchInit?.body as string);
    expect(searchBody.jql).toContain('issuetype = "Epic"');
    const [, createInit] = fetchMock.mock.calls[2];
    const createBody = JSON.parse(createInit?.body as string);
    expect(createBody.fields.issuetype).toEqual({ id: "12" });
    expect(createBody.fields.parent).toBeUndefined();
  });

  it("updates in place without touching issue type or parent when a matching Epic already exists", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [{ key: "ENG-1", fields: { summary: "my-feature" } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await upsertJiraIssue(creds, {
      kind: "epic",
      projectKey: "ENG",
      summary: "my-feature",
      description: "revised",
    });

    expect(result.action).toBe("updated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
