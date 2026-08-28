import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/proxyFetch", () => ({
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "@/modules/ai/lib/proxyFetch";
import {
  AtlassianApiError,
  filterAtlassianItems,
  getConfluencePage,
  getJiraIssue,
  listConfluenceSpaces,
  listJiraProjects,
  normalizeAtlassianSite,
  searchCql,
  searchJql,
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
