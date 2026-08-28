const GITHUB_API_BASE = "https://api.github.com";
const MAX_REPO_PAGES = 5;
const REPOS_PER_PAGE = 100;

export class GithubApiError extends Error {}

export type GithubUser = { login: string };

export type GithubRepo = {
  id: number;
  fullName: string;
  private: boolean;
  htmlUrl: string;
};

async function githubFetch(
  path: string,
  token: string,
  accept = "application/vnd.github+json",
): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  }) as Promise<Response>;
}

// GitHub's search API rejects queries longer than ~256 chars with a 422.
// Leave headroom for the caller's own search term by capping the `repo:`
// qualifier portion well under that limit — silently dropping repos past
// the cap beats every search call failing outright for a large selection.
const MAX_REPO_QUALIFIER_CHARS = 200;

/** Combines selected repos into GitHub search syntax: `repo:a OR repo:b`. */
function repoQualifier(repos: readonly string[]): string {
  const parts: string[] = [];
  let len = 0;
  for (const r of repos) {
    const part = `repo:${r}`;
    const added = part.length + (parts.length > 0 ? 4 : 0); // " OR "
    if (len + added > MAX_REPO_QUALIFIER_CHARS) break;
    parts.push(part);
    len += added;
  }
  return parts.join(" OR ");
}

export async function validateGithubToken(token: string): Promise<GithubUser> {
  const res = await githubFetch("/user", token);
  if (!res.ok) {
    if (res.status === 401) {
      throw new GithubApiError("Invalid or expired token.");
    }
    throw new GithubApiError(`GitHub API error (${res.status}).`);
  }
  const data = (await res.json()) as { login: string };
  return { login: data.login };
}

export type GithubRepoPage = {
  repos: GithubRepo[];
  /** True if MAX_REPO_PAGES was hit and more repos may exist beyond this list. */
  truncated: boolean;
};

export async function listGithubRepos(token: string): Promise<GithubRepoPage> {
  const repos: GithubRepo[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const res = await githubFetch(
      `/user/repos?per_page=${REPOS_PER_PAGE}&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`,
      token,
    );
    if (!res.ok) {
      throw new GithubApiError(`GitHub API error (${res.status}).`);
    }
    const data = (await res.json()) as Array<{
      id: number;
      full_name: string;
      private: boolean;
      html_url: string;
    }>;
    repos.push(
      ...data.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        private: r.private,
        htmlUrl: r.html_url,
      })),
    );
    if (data.length < REPOS_PER_PAGE) break;
    if (page === MAX_REPO_PAGES) truncated = true;
  }
  return { repos, truncated };
}

export function filterRepos(
  repos: readonly GithubRepo[],
  query: string,
): GithubRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...repos];
  return repos.filter((r) => r.fullName.toLowerCase().includes(q));
}

const SEARCH_RESULTS_PER_PAGE = 15;
const MAX_FILE_CONTENT_CHARS = 20_000;

export type GithubCodeHit = {
  repo: string;
  path: string;
  url: string;
  /** Highlighted snippet fragments around the match, when available. */
  fragments: string[];
};

/** Code search, scoped to `repos` via `repo:a OR repo:b OR …`. */
export async function searchCode(
  token: string,
  query: string,
  repos: readonly string[],
): Promise<GithubCodeHit[]> {
  if (repos.length === 0) return [];
  const q = `${query} ${repoQualifier(repos)}`;
  const res = await githubFetch(
    `/search/code?q=${encodeURIComponent(q)}&per_page=${SEARCH_RESULTS_PER_PAGE}`,
    token,
    "application/vnd.github.text-match+json",
  );
  if (!res.ok) {
    throw new GithubApiError(`GitHub API error (${res.status}).`);
  }
  const data = (await res.json()) as {
    items: Array<{
      path: string;
      repository: { full_name: string };
      html_url: string;
      text_matches?: Array<{ fragment: string }>;
    }>;
  };
  return data.items.map((it) => ({
    repo: it.repository.full_name,
    path: it.path,
    url: it.html_url,
    fragments: (it.text_matches ?? []).map((m) => m.fragment),
  }));
}

export type GithubIssueHit = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isPullRequest: boolean;
  bodySnippet: string;
};

/** Issue/PR search, scoped to `repos` via `repo:a OR repo:b OR …`. */
export async function searchIssuesAndPrs(
  token: string,
  query: string,
  repos: readonly string[],
): Promise<GithubIssueHit[]> {
  if (repos.length === 0) return [];
  const q = `${query} ${repoQualifier(repos)}`;
  const res = await githubFetch(
    `/search/issues?q=${encodeURIComponent(q)}&per_page=${SEARCH_RESULTS_PER_PAGE}`,
    token,
  );
  if (!res.ok) {
    throw new GithubApiError(`GitHub API error (${res.status}).`);
  }
  const data = (await res.json()) as {
    items: Array<{
      number: number;
      title: string;
      html_url: string;
      repository_url: string;
      state: string;
      pull_request?: unknown;
      body: string | null;
    }>;
  };
  return data.items.map((it) => ({
    repo: it.repository_url.replace("https://api.github.com/repos/", ""),
    number: it.number,
    title: it.title,
    url: it.html_url,
    state: it.state,
    isPullRequest: !!it.pull_request,
    bodySnippet: (it.body ?? "").slice(0, 300),
  }));
}

export type GithubFileContent = {
  content: string;
  truncated: boolean;
};

/** Encodes each path segment while preserving the `/` separators. */
function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Fetches a single file's raw contents. `repo` is "owner/name". */
export async function getFileContents(
  token: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<GithubFileContent> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(
    `/repos/${repo}/contents/${encodeRepoPath(path)}${query}`,
    token,
    "application/vnd.github.raw+json",
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new GithubApiError(`File not found: ${path} in ${repo}.`);
    }
    throw new GithubApiError(`GitHub API error (${res.status}).`);
  }
  const text = await res.text();
  if (text.length > MAX_FILE_CONTENT_CHARS) {
    return { content: text.slice(0, MAX_FILE_CONTENT_CHARS), truncated: true };
  }
  return { content: text, truncated: false };
}
