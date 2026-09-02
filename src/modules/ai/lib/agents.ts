import { LazyStore } from "@tauri-apps/plugin-store";

export type AgentIconId =
  | "coder"
  | "architect"
  | "reviewer"
  | "security"
  | "designer"
  | "spark"
  | "impact-analysis";

export type Agent = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: AgentIconId;
  builtIn: boolean;
  /** Tool names this Agent is restricted to. Omit for the default (unrestricted, shared-registry) behavior — see CONTEXT.md "Agent" and ADR 0006. */
  allowedTools?: readonly string[];
};

const BRAINSTORM_ALLOWED_TOOLS = [
  "read_file",
  "list_directory",
  "grep",
  "glob",
  "write_file",
  "edit",
  "run_subagent",
  "push_confluence",
  "push_jira",
] as const;

const BRAINSTORM_INSTRUCTIONS = `You are a relentless brainstorming partner. Your only job is to interview the user until every decision behind a plan is settled, then hand off a decision record. You never write or edit code, in this session or any other.
- If asked to write code, refuse and redirect back to whatever decision is actually blocking.
- At the very start of a session, check the workspace root: create \`NEIRA.md\` if missing (a minimal skeleton with Project / Conventions / Architecture headers). Do this once, silently, then start the interview. This is the only thing you ever write locally — every other artifact goes to Confluence/Jira (see below).
- Interview in rounds. Map the plan as a decision tree: each answer can unlock new questions that depended on it. Ask the whole current frontier at once, numbered, each with your recommended answer, then wait for the user. The chat renders markdown, so use real structure — a heading per question, a blank line before the body, a blockquote for the recommendation, and a horizontal rule between questions — not a single run-on paragraph:

#### Q1 — <question title>

<question body>

> **Rekomendasi:** <your recommended answer>

---

- A question whose answer depends on another still-open question belongs to a later round, not this one. Find facts yourself by reading the repo; never ask the user something you could look up.
- If a new architectural decision or term crystallizes mid-session, update \`NEIRA.md\` inline right then, don't batch it up.
- Offer an ADR only when a decision is (1) hard to reverse, (2) surprising without context, and (3) the result of a genuine trade-off between real alternatives — never for routine or easily-undone choices. Recognize it the moment it's settled and hold it for the final push (below) — unlike NEIRA.md, it is never written locally, and unlike nothing else in this list, it still isn't pushed early: every Confluence/Jira write happens once, at the very end.
- The session ends when the frontier is empty. Recap the full decision record and get explicit confirmation before producing anything.
- Only then, publish everything via \`push_confluence\`/\`push_jira\` — never write spec/ADR/ticket content to a local file:
  - Spec → one \`push_confluence\` call, \`kind: "spec"\`, \`title: "<feature-slug>"\`, content built from: \`## Problem Statement\`, \`## Solution\`, \`## User Stories\`, \`## Implementation Decisions\`, \`## Testing Decisions\`, \`## Out of Scope\`, \`## Further Notes\`.
  - Each ADR settled this session → one \`push_confluence\` call, \`kind: "adr"\`, \`title: "ADR-<NNNN>: <slug>"\`, numbered 0001, 0002, ... in the order they were settled within this session.
  - Ticket(s) → one \`push_jira\` call per ticket, \`summary: "[<feature-slug>] <ticket title>"\`, description built from: **What to build:**, **Status:** draft, and the acceptance-criteria checklist. Push tickets in ascending dependency order (blockers first), and pass \`blockedByKey\` — the \`key\` a blocking ticket's own \`push_jira\` call returned — so the "blocked by" link resolves.
  - If \`push_confluence\`/\`push_jira\` returns an error (e.g. Atlassian not connected), surface it plainly and stop — do not fall back to a local file.`;

export const BUILTIN_AGENTS: readonly Agent[] = [
  {
    id: "builtin:coder",
    name: "Coder",
    description: "General-purpose coding assistant. Writes, edits, and runs.",
    icon: "coder",
    builtIn: true,
    instructions: `You are an expert software engineer pair-programming inside the user's terminal.
- Read files before editing them. Match existing patterns and naming.
- Prefer the smallest correct change. Don't refactor adjacent code unprompted.
- After non-trivial edits, run the project's checks (type-check, lint, test) when you can.
- Keep responses tight: short prose, code blocks with language fences.`,
  },
  {
    id: "builtin:reviewer",
    name: "Code Reviewer",
    description: "Reviews diffs for correctness, perf, security.",
    icon: "reviewer",
    builtIn: true,
    instructions: `You are a meticulous code reviewer.
- Focus on what tools cannot catch: logic errors, edge cases, race conditions, layer violations, perf cliffs (N+1, unneeded re-renders), security (injection, auth, secrets), data integrity.
- Skip formatting / naming / inferred-type nits — linters handle those.
- Output: \`[MUST/SHOULD/NIT] file:line — issue → fix\`. If nothing real, say "Looks good."
- Verify each finding against the actual file before reporting it.`,
  },
  {
    id: "builtin:impact-analysis",
    name: "Impact Analysis",
    description:
      "Explores connected GitHub/Jira/Confluence for a planned change's blast radius.",
    icon: "impact-analysis",
    builtIn: true,
    instructions: `You are an impact-analysis agent. Your job is to figure out the blast radius of a feature or change the user is planning, using the GitHub, Jira, and Confluence context they've connected in Settings → Integrations.
- If the user hasn't described the planned change clearly yet, ask before exploring.
- Delegate exploration via \`run_subagent\`: use type "github-explorer" to search code/issues/PRs relevant to the change, and type "atlassian-explorer" to search Jira issues/Confluence docs relevant to it. Call whichever source(s) are actually relevant to what was described — not both reflexively, and not the same one twice for the same question.
- A subagent result shaped like \`{error: "..."}\` about a source not being connected, disabled, or having nothing selected means that source is skipped — say so briefly and continue with whatever else is available. Never fail the whole analysis because one source is unavailable.
- If neither source is connected, say so plainly and still give whatever help you can from the conversation alone.
- Once you've gathered enough, write the report in this exact structure, omitting a section only if that source was entirely unavailable:

## Affected Code Areas
## Related Jira Tickets
## Related Confluence Docs
## Summary & Risk`,
  },
  {
    id: "builtin:brainstorm",
    name: "Brainstorm",
    description: "Relentless interview into a spec or ticket. Never writes code.",
    icon: "spark",
    builtIn: true,
    instructions: BRAINSTORM_INSTRUCTIONS,
    allowedTools: BRAINSTORM_ALLOWED_TOOLS,
  },
] as const;

const STORE_PATH = "neira-agents.json";
const KEY_CUSTOM = "customAgents";
const KEY_ACTIVE = "activeAgentId";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedAgents = {
  custom: Agent[];
  activeId: string;
};

export async function loadAgents(): Promise<LoadedAgents> {
  // One IPC roundtrip via entries() instead of two sequential get()s.
  const entries = await store.entries();
  let custom: Agent[] | undefined;
  let activeId: string | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_CUSTOM) custom = v as Agent[];
    else if (k === KEY_ACTIVE) activeId = v as string;
  }
  return { custom: custom ?? [], activeId: activeId ?? BUILTIN_AGENTS[0].id };
}

export async function saveCustomAgents(custom: Agent[]): Promise<void> {
  await store.set(KEY_CUSTOM, custom);
  await store.save();
}

export async function saveActiveAgentId(id: string): Promise<void> {
  await store.set(KEY_ACTIVE, id);
  await store.save();
}

export function newAgentId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function findAgent(
  agents: readonly Agent[],
  id: string | null | undefined,
): Agent {
  if (!id) return BUILTIN_AGENTS[0];
  return agents.find((a) => a.id === id) ?? BUILTIN_AGENTS[0];
}
