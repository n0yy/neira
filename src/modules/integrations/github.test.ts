import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterRepos,
  GithubApiError,
  listGithubRepos,
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
