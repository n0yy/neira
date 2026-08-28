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
  init?: { method?: string; body?: string },
): Promise<Response> {
  // Atlassian Cloud's REST API doesn't send CORS headers for third-party
  // origins (unlike GitHub's), so a direct webview `fetch()` fails with
  // "Load failed". Route through the Rust-side HTTP proxy instead, which
  // makes a native request unaffected by browser CORS.
  return proxyFetch(`https://${normalizeAtlassianSite(creds.site)}${path}`, {
    method: init?.method,
    headers: {
      Authorization: authHeader(creds.email, creds.token),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
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

const SEARCH_RESULTS_LIMIT = 25;
const MAX_TEXT_CHARS = 20_000;

function jqlQuoteList(values: readonly string[]): string {
  return values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
}

/**
 * Inserts `AND <clause>` into a JQL/CQL query, ahead of a trailing `ORDER BY`
 * if present — wrapping the whole query (including ORDER BY) in parentheses
 * is invalid syntax, since ORDER BY must be the outermost trailing clause.
 */
function scopeQuery(query: string, clause: string): string {
  const match = query.match(/\bORDER\s+BY\b/i);
  if (!match || match.index === undefined) {
    return `(${query}) AND ${clause}`;
  }
  const before = query.slice(0, match.index).trim();
  const orderBy = query.slice(match.index).trim();
  return `(${before}) AND ${clause} ${orderBy}`;
}

function clipText(text: string): string {
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}…`
    : text;
}

/** Minimal Atlassian Document Format → plain text (paragraphs/headings only). */
type AdfNode = { type?: string; text?: string; content?: AdfNode[] };
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as AdfNode;
  if (n.type === "text") return n.text ?? "";
  const child = (n.content ?? []).map(adfToText).join("");
  return n.type === "paragraph" || n.type === "heading" ? `${child}\n` : child;
}

/** Strips Confluence's storage-format markup (XHTML-based) down to text. */
function stripStorageFormat(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips CQL search-result highlight markers (`@@@hl@@@word@@@endhl@@@`). */
function stripHighlightMarkers(text: string): string {
  return text.replace(/@@@(?:end)?hl@@@/g, "");
}

export type JiraIssueHit = {
  key: string;
  summary: string;
  status: string;
  url: string;
};

/**
 * Searches Jira issues via `POST /rest/api/3/search/jql` — the replacement
 * for the removed `GET /rest/api/3/search`. Deliberately does NOT paginate
 * via `nextPageToken`: Atlassian's own issue tracker has reports of that
 * token never terminating (`isLast` staying false indefinitely), so a single
 * capped page is both simpler and safer for a search tool that only needs
 * the top matches.
 */
export async function searchJql(
  creds: AtlassianCredentials,
  jql: string,
  projectKeys: readonly string[],
): Promise<JiraIssueHit[]> {
  if (projectKeys.length === 0) return [];
  const scopedJql = scopeQuery(jql, `project in (${jqlQuoteList(projectKeys)})`);
  const res = await atlassianFetch(creds, "/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql: scopedJql,
      maxResults: SEARCH_RESULTS_LIMIT,
      fields: ["summary", "status"],
    }),
  });
  requireOk(res);
  const data = (await res.json()) as {
    issues: Array<{
      key: string;
      fields: { summary: string; status?: { name: string } };
    }>;
  };
  const site = normalizeAtlassianSite(creds.site);
  return data.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name ?? "",
    url: `https://${site}/browse/${i.key}`,
  }));
}

export type ConfluencePageHit = {
  id: string;
  title: string;
  excerpt: string;
  url: string;
};

/** Searches Confluence pages via CQL against `GET /wiki/rest/api/search`. */
export async function searchCql(
  creds: AtlassianCredentials,
  cql: string,
  spaceKeys: readonly string[],
): Promise<ConfluencePageHit[]> {
  if (spaceKeys.length === 0) return [];
  const scopedCql = scopeQuery(cql, `space in (${jqlQuoteList(spaceKeys)})`);
  const res = await atlassianFetch(
    creds,
    `/wiki/rest/api/search?cql=${encodeURIComponent(scopedCql)}&limit=${SEARCH_RESULTS_LIMIT}`,
  );
  requireOk(res);
  const data = (await res.json()) as {
    results: Array<{
      content?: { id: string; title: string };
      title?: string;
      excerpt?: string;
      url: string;
    }>;
  };
  const site = normalizeAtlassianSite(creds.site);
  return data.results.map((r) => ({
    id: r.content?.id ?? "",
    title: r.content?.title ?? r.title ?? "",
    excerpt: stripHighlightMarkers(r.excerpt ?? ""),
    url: `https://${site}/wiki${r.url}`,
  }));
}

export type JiraIssueDetail = JiraIssueHit & { description: string };

/** Fetches one Jira issue's full fields, including its description as plain text. */
export async function getJiraIssue(
  creds: AtlassianCredentials,
  key: string,
): Promise<JiraIssueDetail> {
  const res = await atlassianFetch(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,description`,
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new AtlassianApiError(`Issue not found: ${key}.`);
    }
    requireOk(res);
  }
  const data = (await res.json()) as {
    key: string;
    fields: {
      summary: string;
      status?: { name: string };
      description?: unknown;
    };
  };
  const site = normalizeAtlassianSite(creds.site);
  return {
    key: data.key,
    summary: data.fields.summary,
    status: data.fields.status?.name ?? "",
    url: `https://${site}/browse/${data.key}`,
    description: clipText(adfToText(data.fields.description).trim()),
  };
}

export type ConfluencePageDetail = {
  id: string;
  title: string;
  spaceKey: string;
  content: string;
  url: string;
};

/** Fetches one Confluence page's full body content as plain text. */
export async function getConfluencePage(
  creds: AtlassianCredentials,
  id: string,
): Promise<ConfluencePageDetail> {
  const res = await atlassianFetch(
    creds,
    `/wiki/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,space`,
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new AtlassianApiError(`Page not found: ${id}.`);
    }
    requireOk(res);
  }
  const data = (await res.json()) as {
    id: string;
    title: string;
    space?: { key: string };
    body?: { storage?: { value: string } };
    _links?: { webui?: string };
  };
  const site = normalizeAtlassianSite(creds.site);
  return {
    id: data.id,
    title: data.title,
    spaceKey: data.space?.key ?? "",
    content: clipText(stripStorageFormat(data.body?.storage?.value ?? "")),
    url: `https://${site}/wiki${data._links?.webui ?? ""}`,
  };
}
