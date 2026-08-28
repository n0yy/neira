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

async function githubFetch(path: string, token: string): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  }) as Promise<Response>;
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
