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

/**
 * Converts plain text into Confluence storage-format XHTML: blank-line
 * blocks become `<p>` paragraphs, single newlines within a block become
 * `<br/>`, and `& < >` are escaped. `push_confluence`'s `content` input is
 * always plain text (never storage format), so every write goes through
 * this — unescaped `&`/`<`/`>` would otherwise make Confluence reject the
 * request as malformed XHTML.
 */
export function plainTextToConfluenceStorage(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block).replace(/\n/g, "<br/>")}</p>`)
    .join("");
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

export type ConfluenceWriteResult = { id: string; url: string };

function confluenceWriteResultFrom(
  creds: AtlassianCredentials,
  data: { id: string; _links?: { webui?: string } },
): ConfluenceWriteResult {
  const site = normalizeAtlassianSite(creds.site);
  return { id: data.id, url: `https://${site}/wiki${data._links?.webui ?? ""}` };
}

/**
 * Finds a Confluence page by its exact title within one space, via CQL
 * (`title = "..." AND type = page`) — the same read-only `searchCql` the
 * explorer tools use, reused here so create-vs-update never needs a
 * separately stored id/mapping (see ADR 0006).
 */
export async function findConfluencePageByTitle(
  creds: AtlassianCredentials,
  spaceKey: string,
  title: string,
): Promise<{ id: string } | null> {
  const cql = `title = "${title.replace(/"/g, '\\"')}" AND type = page`;
  const hits = await searchCql(creds, cql, [spaceKey]);
  const exact = hits.find((h) => h.title === title);
  return exact ? { id: exact.id } : null;
}

/** Creates a new Confluence page. `parentId`, when given, nests it under that page. */
export async function createConfluencePage(
  creds: AtlassianCredentials,
  params: {
    spaceKey: string;
    title: string;
    content: string;
    parentId?: string;
  },
): Promise<ConfluenceWriteResult> {
  const res = await atlassianFetch(creds, "/wiki/rest/api/content", {
    method: "POST",
    body: JSON.stringify({
      type: "page",
      title: params.title,
      space: { key: params.spaceKey },
      ...(params.parentId ? { ancestors: [{ id: params.parentId }] } : {}),
      body: { storage: { value: params.content, representation: "storage" } },
    }),
  });
  requireOk(res);
  const data = (await res.json()) as { id: string; _links?: { webui?: string } };
  return confluenceWriteResultFrom(creds, data);
}

/** Updates an existing Confluence page's title/content, bumping its version number. */
export async function updateConfluencePage(
  creds: AtlassianCredentials,
  params: { id: string; title: string; content: string },
): Promise<ConfluenceWriteResult> {
  const metaRes = await atlassianFetch(
    creds,
    `/wiki/rest/api/content/${encodeURIComponent(params.id)}?expand=version`,
  );
  requireOk(metaRes);
  const meta = (await metaRes.json()) as { version: { number: number } };

  const res = await atlassianFetch(
    creds,
    `/wiki/rest/api/content/${encodeURIComponent(params.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        id: params.id,
        type: "page",
        title: params.title,
        version: { number: meta.version.number + 1 },
        body: { storage: { value: params.content, representation: "storage" } },
      }),
    },
  );
  requireOk(res);
  const data = (await res.json()) as { id: string; _links?: { webui?: string } };
  return confluenceWriteResultFrom(creds, data);
}

export type JiraWriteResult = { key: string; url: string };

function jiraWriteResultFrom(
  creds: AtlassianCredentials,
  key: string,
): JiraWriteResult {
  const site = normalizeAtlassianSite(creds.site);
  return { key, url: `https://${site}/browse/${key}` };
}

/**
 * Converts plain text into an ADF (Atlassian Document Format) doc: blank-line
 * blocks become paragraphs, single newlines within a block become
 * `hardBreak` nodes. ADF has no implicit line-break semantics — a bare `\n`
 * inside one text node renders as a space, not a break — so a multi-section
 * Jira description (Brainstorm's `**What to build:**` / `**Status:**` /
 * checklist layout) needs this instead of one flat text node.
 */
function adfFromText(text: string): unknown {
  const paragraphs = text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const content: unknown[] = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
    return { type: "paragraph", content };
  });
  return { type: "doc", version: 1, content: paragraphs };
}

/** Finds a Jira issue by its exact summary within one project, via the existing read-only `searchJql`. Pass `issueTypeName` to avoid an Epic and a Task colliding on the same summary text. */
export async function findJiraIssueBySummary(
  creds: AtlassianCredentials,
  projectKey: string,
  summary: string,
  issueTypeName?: string,
): Promise<{ key: string } | null> {
  const base = `summary ~ "${summary.replace(/"/g, '\\"')}"`;
  const jql = issueTypeName
    ? `${base} AND issuetype = "${issueTypeName.replace(/"/g, '\\"')}"`
    : base;
  const hits = await searchJql(creds, jql, [projectKey]);
  const exact = hits.find((h) => h.summary === summary);
  return exact ? { key: exact.key } : null;
}

async function fetchJiraProjectIssueTypes(
  creds: AtlassianCredentials,
  projectKey: string,
): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
  const res = await atlassianFetch(
    creds,
    `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
  );
  requireOk(res);
  const data = (await res.json()) as {
    issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
  };
  return data.issueTypes ?? [];
}

/** The project's first non-subtask, non-Epic issue type — used as the "default" type for created Task issues (not configurable in v1). */
export async function getDefaultJiraIssueType(
  creds: AtlassianCredentials,
  projectKey: string,
): Promise<{ id: string; name: string }> {
  const types = await fetchJiraProjectIssueTypes(creds, projectKey);
  const type = types.find((t) => !t.subtask && t.name !== "Epic");
  if (!type) {
    throw new AtlassianApiError(
      `Project ${projectKey} has no non-subtask issue types.`,
    );
  }
  return { id: type.id, name: type.name };
}

/** Finds a project's issue type by its exact name (e.g. "Epic" — a Jira system type name, safe to hardcode; not configurable in v1). */
export async function getJiraIssueTypeByName(
  creds: AtlassianCredentials,
  projectKey: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const types = await fetchJiraProjectIssueTypes(creds, projectKey);
  const type = types.find((t) => t.name === name);
  if (!type) {
    throw new AtlassianApiError(
      `Project ${projectKey} has no "${name}" issue type.`,
    );
  }
  return { id: type.id, name: type.name };
}

/** Creates a new Jira issue. Uses the project's default issue type unless `issueTypeId` is given; sets `parent` when `parentKey` is given (team-managed-project epic-child linking — see ADR 0006). */
export async function createJiraIssue(
  creds: AtlassianCredentials,
  params: {
    projectKey: string;
    summary: string;
    description: string;
    issueTypeId?: string;
    parentKey?: string;
  },
): Promise<JiraWriteResult> {
  const issueTypeId =
    params.issueTypeId ??
    (await getDefaultJiraIssueType(creds, params.projectKey)).id;
  const res = await atlassianFetch(creds, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: params.projectKey },
        summary: params.summary,
        issuetype: { id: issueTypeId },
        description: adfFromText(params.description),
        ...(params.parentKey ? { parent: { key: params.parentKey } } : {}),
      },
    }),
  });
  requireOk(res);
  const data = (await res.json()) as { key: string };
  return jiraWriteResultFrom(creds, data.key);
}

/** Updates an existing Jira issue's summary/description. */
export async function updateJiraIssue(
  creds: AtlassianCredentials,
  params: { key: string; summary: string; description: string },
): Promise<JiraWriteResult> {
  const res = await atlassianFetch(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(params.key)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          summary: params.summary,
          description: adfFromText(params.description),
        },
      }),
    },
  );
  requireOk(res);
  return jiraWriteResultFrom(creds, params.key);
}

/** Links `blockedKey` as "is blocked by" `blockerKey`, via Jira's native "Blocks" issue-link type. */
export async function createJiraBlockedByLink(
  creds: AtlassianCredentials,
  params: { blockedKey: string; blockerKey: string },
): Promise<void> {
  const res = await atlassianFetch(creds, "/rest/api/3/issueLink", {
    method: "POST",
    body: JSON.stringify({
      type: { name: "Blocks" },
      inwardIssue: { key: params.blockedKey },
      outwardIssue: { key: params.blockerKey },
    }),
  });
  requireOk(res);
}

export type JiraIssueArtifact =
  | {
      kind: "epic";
      projectKey: string;
      summary: string;
      description: string;
    }
  | {
      kind: "task";
      projectKey: string;
      summary: string;
      description: string;
      /** Key of this ticket's Epic — set as the `parent` field (team-managed-project epic-child linking; see ADR 0006). */
      epicKey: string;
      /** Issue key of a previously-pushed blocking ticket, if any. Orthogonal to `epicKey`: Jira's parent-link doesn't imply blocking. */
      blockedByKey?: string;
    };

/**
 * Creates or updates a Jira issue for an Epic or ticket Artifact, deciding
 * which by searching for the issue's predictable summary first — see
 * `findJiraIssueBySummary`. No issue-key mapping is stored anywhere else.
 * The Epic search is scoped to `issuetype = Epic` so it can't collide with a
 * same-named Task.
 */
export async function upsertJiraIssue(
  creds: AtlassianCredentials,
  params: JiraIssueArtifact,
): Promise<JiraWriteResult & { action: "created" | "updated" }> {
  const existing = await findJiraIssueBySummary(
    creds,
    params.projectKey,
    params.summary,
    params.kind === "epic" ? "Epic" : undefined,
  );
  let result: JiraWriteResult & { action: "created" | "updated" };
  if (existing) {
    result = {
      ...(await updateJiraIssue(creds, {
        key: existing.key,
        summary: params.summary,
        description: params.description,
      })),
      action: "updated",
    };
  } else if (params.kind === "epic") {
    const epicType = await getJiraIssueTypeByName(
      creds,
      params.projectKey,
      "Epic",
    );
    result = {
      ...(await createJiraIssue(creds, {
        projectKey: params.projectKey,
        summary: params.summary,
        description: params.description,
        issueTypeId: epicType.id,
      })),
      action: "created",
    };
  } else {
    result = {
      ...(await createJiraIssue(creds, {
        projectKey: params.projectKey,
        summary: params.summary,
        description: params.description,
        parentKey: params.epicKey,
      })),
      action: "created",
    };
  }
  if (params.kind === "task" && params.blockedByKey) {
    await createJiraBlockedByLink(creds, {
      blockedKey: result.key,
      blockerKey: params.blockedByKey,
    });
  }
  return result;
}

/** Gets the id of the "Specs" or "ADRs" parent page in a space, creating it (empty) if missing. */
export async function getOrCreateConfluenceParentPage(
  creds: AtlassianCredentials,
  spaceKey: string,
  name: "Specs" | "ADRs",
): Promise<string> {
  const existing = await findConfluencePageByTitle(creds, spaceKey, name);
  if (existing) return existing.id;
  const created = await createConfluencePage(creds, {
    spaceKey,
    title: name,
    content: "",
  });
  return created.id;
}

export type ConfluenceArtifactKind = "spec" | "adr";

/**
 * Creates or updates a Confluence page for a spec/ADR Artifact, deciding
 * which by searching for the page's predictable title first — see
 * `findConfluencePageByTitle`. No page-id mapping is stored anywhere else.
 */
export async function upsertConfluencePage(
  creds: AtlassianCredentials,
  params: {
    spaceKey: string;
    kind: ConfluenceArtifactKind;
    title: string;
    content: string;
  },
): Promise<ConfluenceWriteResult & { action: "created" | "updated" }> {
  const parentName = params.kind === "spec" ? "Specs" : "ADRs";
  const existing = await findConfluencePageByTitle(
    creds,
    params.spaceKey,
    params.title,
  );
  if (existing) {
    const updated = await updateConfluencePage(creds, {
      id: existing.id,
      title: params.title,
      content: params.content,
    });
    return { ...updated, action: "updated" };
  }
  const parentId = await getOrCreateConfluenceParentPage(
    creds,
    params.spaceKey,
    parentName,
  );
  const created = await createConfluencePage(creds, {
    spaceKey: params.spaceKey,
    title: params.title,
    content: params.content,
    parentId,
  });
  return { ...created, action: "created" };
}
