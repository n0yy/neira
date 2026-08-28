import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/proxyFetch", () => ({
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "@/modules/ai/lib/proxyFetch";
import {
  AtlassianApiError,
  filterAtlassianItems,
  listConfluenceSpaces,
  listJiraProjects,
  normalizeAtlassianSite,
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
