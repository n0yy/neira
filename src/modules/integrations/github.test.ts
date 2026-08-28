import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterRepos,
  getFileContents,
  GithubApiError,
  listGithubRepos,
  searchCode,
  searchIssuesAndPrs,
  validateGithubToken,
  type GithubRepo,
} from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateGithubToken", () => {
  it("returns the authenticated login on success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ login: "octocat" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await validateGithubToken("ghp_test");

    expect(user).toEqual({ login: "octocat" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghp_test" }),
      }),
    );
  });

  it("throws a GithubApiError with a friendly message on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );

    await expect(validateGithubToken("bad-token")).rejects.toThrow(
      GithubApiError,
    );
    await expect(validateGithubToken("bad-token")).rejects.toThrow(
      /invalid or expired/i,
    );
  });

  it("throws a GithubApiError on other non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    await expect(validateGithubToken("ghp_test")).rejects.toThrow(
      /GitHub API error \(500\)/,
    );
  });
});

describe("listGithubRepos", () => {
  it("returns repos from a single page", async () => {
    const page = [
      { id: 1, full_name: "octocat/hello", private: false, html_url: "u1" },
      { id: 2, full_name: "octocat/world", private: true, html_url: "u2" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => page })),
    );

    const result = await listGithubRepos("ghp_test");

    expect(result.truncated).toBe(false);
    expect(result.repos).toEqual([
      { id: 1, fullName: "octocat/hello", private: false, htmlUrl: "u1" },
      { id: 2, fullName: "octocat/world", private: true, htmlUrl: "u2" },
    ]);
  });

  it("paginates until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      full_name: `org/repo-${i}`,
      private: false,
      html_url: `u${i}`,
    }));
    const shortPage = [
      { id: 999, full_name: "org/last", private: false, html_url: "last" },
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => (call === 1 ? fullPage : shortPage),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listGithubRepos("ghp_test");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(false);
    expect(result.repos).toHaveLength(101);
    expect(result.repos[result.repos.length - 1]).toEqual({
      id: 999,
      fullName: "org/last",
      private: false,
      htmlUrl: "last",
    });
  });

  it("marks the result truncated when MAX_REPO_PAGES is exhausted by full pages", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        Array.from({ length: 100 }, (_, i) => ({
          id: i,
          full_name: `org/repo-${i}`,
          private: false,
          html_url: `u${i}`,
        })),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listGithubRepos("ghp_test");

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.truncated).toBe(true);
    expect(result.repos).toHaveLength(500);
  });

  it("throws a GithubApiError when a page request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    );

    await expect(listGithubRepos("ghp_test")).rejects.toThrow(
      GithubApiError,
    );
  });
});

describe("searchCode", () => {
  it("returns an empty array without calling fetch when no repos are selected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchCode("ghp_test", "useAuthStore", []);

    expect(hits).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combines selected repos with OR and requests text-match highlighting", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                path: "src/auth.ts",
                repository: { full_name: "octocat/hello" },
                html_url:
                  "https://github.com/octocat/hello/blob/main/src/auth.ts",
                text_matches: [{ fragment: "export function login() {}" }],
              },
            ],
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchCode("ghp_test", "login", [
      "octocat/hello",
      "octocat/world",
    ]);

    expect(hits).toEqual([
      {
        repo: "octocat/hello",
        path: "src/auth.ts",
        url: "https://github.com/octocat/hello/blob/main/src/auth.ts",
        fragments: ["export function login() {}"],
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent("repo:octocat/hello OR repo:octocat/world"),
    );
    if (!init) throw new Error("fetch was called without an init object");
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/vnd.github.text-match+json",
    );
  });

  it("throws a GithubApiError on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })),
    );

    await expect(
      searchCode("ghp_test", "x", ["octocat/hello"]),
    ).rejects.toThrow(GithubApiError);
  });

  it("caps the repo: qualifier well under GitHub's query-length limit", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    // Each name is long enough that all 30 together would blow past the cap.
    const manyRepos = Array.from(
      { length: 30 },
      (_, i) => `octocat/some-long-repo-name-${i}`,
    );

    await searchCode("ghp_test", "x", manyRepos);

    const [url] = fetchMock.mock.calls[0];
    const decoded = decodeURIComponent(url as string);
    const qualifierPart = decoded.split("q=")[1];
    expect(qualifierPart.length).toBeLessThan(230);
    expect(qualifierPart).not.toContain("some-long-repo-name-29");
  });
});

describe("searchIssuesAndPrs", () => {
  it("returns an empty array without calling fetch when no repos are selected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchIssuesAndPrs("ghp_test", "bug", []);

    expect(hits).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps issue and PR fields, deriving repo from repository_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 42,
              title: "Login fails on retry",
              html_url: "https://github.com/octocat/hello/issues/42",
              repository_url: "https://api.github.com/repos/octocat/hello",
              state: "open",
              pull_request: undefined,
              body: "x".repeat(400),
            },
            {
              number: 43,
              title: "Fix login retry",
              html_url: "https://github.com/octocat/hello/pull/43",
              repository_url: "https://api.github.com/repos/octocat/hello",
              state: "open",
              pull_request: { url: "..." },
              body: null,
            },
          ],
        }),
      })),
    );

    const hits = await searchIssuesAndPrs("ghp_test", "login", [
      "octocat/hello",
    ]);

    expect(hits).toEqual([
      {
        repo: "octocat/hello",
        number: 42,
        title: "Login fails on retry",
        url: "https://github.com/octocat/hello/issues/42",
        state: "open",
        isPullRequest: false,
        bodySnippet: "x".repeat(300),
      },
      {
        repo: "octocat/hello",
        number: 43,
        title: "Fix login retry",
        url: "https://github.com/octocat/hello/pull/43",
        state: "open",
        isPullRequest: true,
        bodySnippet: "",
      },
    ]);
  });
});

describe("getFileContents", () => {
  it("fetches raw content with the raw media type", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          text: async () => "export const x = 1;",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getFileContents(
      "ghp_test",
      "octocat/hello",
      "src/x.ts",
    );

    expect(result).toEqual({ content: "export const x = 1;", truncated: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/octocat/hello/contents/src/x.ts",
    );
    if (!init) throw new Error("fetch was called without an init object");
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/vnd.github.raw+json",
    );
  });

  it("encodes special characters in the path while preserving slashes", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, status: 200, text: async () => "content" }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await getFileContents(
      "ghp_test",
      "octocat/hello",
      "docs/api reference.md",
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/octocat/hello/contents/docs/api%20reference.md",
    );
  });

  it("appends the ref query param when provided", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          text: async () => "content",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await getFileContents("ghp_test", "octocat/hello", "a.ts", "feature-x");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/octocat/hello/contents/a.ts?ref=feature-x",
    );
  });

  it("truncates content past the max length and sets truncated: true", async () => {
    const longText = "a".repeat(25_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => longText })),
    );

    const result = await getFileContents("ghp_test", "octocat/hello", "big.ts");

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(20_000);
  });

  it("throws a GithubApiError with a friendly message on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })),
    );

    await expect(
      getFileContents("ghp_test", "octocat/hello", "missing.ts"),
    ).rejects.toThrow(/file not found/i);
  });
});

describe("filterRepos", () => {
  const repos: GithubRepo[] = [
    { id: 1, fullName: "octocat/hello-world", private: false, htmlUrl: "u1" },
    { id: 2, fullName: "acme/widget", private: true, htmlUrl: "u2" },
  ];

  it("returns all repos when the query is empty", () => {
    expect(filterRepos(repos, "")).toEqual(repos);
    expect(filterRepos(repos, "   ")).toEqual(repos);
  });

  it("matches case-insensitively against the full name", () => {
    expect(filterRepos(repos, "HELLO")).toEqual([repos[0]]);
    expect(filterRepos(repos, "acme/")).toEqual([repos[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRepos(repos, "no-such-repo")).toEqual([]);
  });
});
