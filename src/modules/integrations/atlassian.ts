import { proxyFetch } from "@/modules/ai/lib/proxyFetch";

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

export class AtlassianApiError extends Error {}

export type AtlassianCredentials = {
  site: string;
  email: string;
  token: string;
};

export type AtlassianProducts = { jira: boolean; confluence: boolean };

export type AtlassianUser = { accountId: string; displayName: string };

export type JiraProject = { key: string; name: string };
export type ConfluenceSpace = { key: string; name: string };

export type AtlassianPage<T> = { items: T[]; truncated: boolean };

/** Accepts a bare site name, a full host, or a URL (with or without a path); returns the bare host. */
export function normalizeAtlassianSite(site: string): string {
  let s = site.trim().replace(/^https?:\/\//, "");
  // Drop everything from the first `/` onward — a pasted URL like
  // "acme.atlassian.net/jira/projects" must not become part of the host.
  const slash = s.indexOf("/");
  if (slash !== -1) s = s.slice(0, slash);
  if (!s.includes(".")) s = `${s}.atlassian.net`;
  return s;
}

function authHeader(email: string, token: string): string {
  return `Basic ${btoa(`${email}:${token}`)}`;
}

async function atlassianFetch(
  creds: AtlassianCredentials,
  path: string,
): Promise<Response> {
  // Atlassian Cloud's REST API doesn't send CORS headers for third-party
  // origins (unlike GitHub's), so a direct webview `fetch()` fails with
  // "Load failed". Route through the Rust-side HTTP proxy instead, which
  // makes a native request unaffected by browser CORS.
  return proxyFetch(`https://${normalizeAtlassianSite(creds.site)}${path}`, {
    headers: {
      Authorization: authHeader(creds.email, creds.token),
      Accept: "application/json",
    },
  });
}

function requireOk(res: Response): void {
  if (res.ok) return;
  if (res.status === 401) {
    throw new AtlassianApiError("Invalid email or API token.");
  }
  throw new AtlassianApiError(`Atlassian API error (${res.status}).`);
}

async function fetchAtlassianUser(
  creds: AtlassianCredentials,
  path: string,
): Promise<AtlassianUser> {
  const res = await atlassianFetch(creds, path);
  requireOk(res);
  const data = (await res.json()) as {
    accountId: string;
    displayName?: string;
    username?: string;
  };
  return {
    accountId: data.accountId,
    displayName: data.displayName ?? data.username ?? data.accountId,
  };
}

export async function validateAtlassianCredentials(
  creds: AtlassianCredentials,
  products: AtlassianProducts,
): Promise<AtlassianUser> {
  if (!products.jira && !products.confluence) {
    throw new AtlassianApiError(
      "Enable Jira and/or Confluence before connecting.",
    );
  }
  // Check every enabled product, not just one — a token can be valid for
  // Jira but scoped/permissioned out of Confluence (or vice versa), and a
  // "Connected" status must mean every enabled product actually works.
  let user: AtlassianUser | undefined;
  if (products.jira) {
    user = await fetchAtlassianUser(creds, "/rest/api/3/myself");
  }
  if (products.confluence) {
    const confluenceUser = await fetchAtlassianUser(
      creds,
      "/wiki/rest/api/user/current",
    );
    user ??= confluenceUser;
  }
  if (!user) {
    // Unreachable given the guard above, but keeps the return type honest.
    throw new AtlassianApiError(
      "Enable Jira and/or Confluence before connecting.",
    );
  }
  return user;
}

export async function listJiraProjects(
  creds: AtlassianCredentials,
): Promise<AtlassianPage<JiraProject>> {
  const items: JiraProject[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const startAt = page * PAGE_SIZE;
    const res = await atlassianFetch(
      creds,
      `/rest/api/3/project/search?maxResults=${PAGE_SIZE}&startAt=${startAt}`,
    );
    requireOk(res);
    const data = (await res.json()) as {
      values: Array<{ id: string; key: string; name: string }>;
      isLast: boolean;
    };
    items.push(...data.values.map((v) => ({ key: v.key, name: v.name })));
    if (data.isLast) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated };
}

export async function listConfluenceSpaces(
  creds: AtlassianCredentials,
): Promise<AtlassianPage<ConfluenceSpace>> {
  const items: ConfluenceSpace[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const res = await atlassianFetch(
      creds,
      `/wiki/rest/api/space?limit=${PAGE_SIZE}&start=${start}`,
    );
    requireOk(res);
    const data = (await res.json()) as {
      results: Array<{ id: number; key: string; name: string }>;
      size: number;
    };
    items.push(...data.results.map((v) => ({ key: v.key, name: v.name })));
    if (data.size < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated };
}

export function filterAtlassianItems<T extends { key: string; name: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (i) => i.key.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
  );
}
