import type { ReasoningConfig } from "./lib/reasoningEffort";

export const KEYRING_SERVICE = "neira";

export type ProviderId = "openai-compatible";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  keyringAccount: string;
  keyPrefix: string | null;
  consoleUrl: string;
  /** Provider accepts (but does not require) an API key. */
  keyOptional?: boolean;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    keyringAccount: "openai-compatible-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.openai.com/docs/api-reference",
    keyOptional: true,
  },
] as const;

export type CustomEndpoint = {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  contextLimit: number;
  reasoning?: ReasoningConfig | null;
};

const COMPAT_MODEL_PREFIX = "compat-";

export function compatModelIdForEndpoint(endpointId: string): string {
  return `${COMPAT_MODEL_PREFIX}${endpointId}`;
}

export function isCompatModelId(modelId: string): boolean {
  return modelId.startsWith(COMPAT_MODEL_PREFIX);
}

export function endpointIdFromCompatModel(modelId: string): string {
  return isCompatModelId(modelId)
    ? modelId.slice(COMPAT_MODEL_PREFIX.length)
    : "";
}

/** One-shot migration of the legacy single OpenAI-compatible config into the
 *  named-endpoint list. Returns one endpoint when the old base URL + model id
 *  were both set, else empty. `id` is supplied by the caller to stay pure. */
export function migrateLegacyCompatEndpoint(
  baseURL: string,
  modelId: string,
  contextLimit: number,
  id: string,
): CustomEndpoint[] {
  if (!baseURL.trim() || !modelId.trim()) return [];
  return [{ id, name: "Custom endpoint", baseURL, modelId, contextLimit }];
}

export function getProvider(id: ProviderId): ProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** 1 (lowest) – 5 (highest). For `cost`, higher = cheaper. */
export type CapabilityScore = 1 | 2 | 3 | 4 | 5;

export type ModelCapabilities = {
  intelligence: CapabilityScore;
  speed: CapabilityScore;
  cost: CapabilityScore;
};

export type ModelTag = "vision" | "reasoning" | "tools" | "coding";

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  label: string;
  /** One short word for the dropdown trigger. */
  hint: string;
  /** One-line marketing-style description shown under the label. */
  description: string;
  capabilities: ModelCapabilities;
  tags?: readonly ModelTag[];
  supportsTemperature?: boolean;
};

export const MODELS = [
  // ── Generic OpenAI-compatible (user-defined endpoint) ─────────────────────
  {
    id: "openai-compatible-custom",
    provider: "openai-compatible",
    label: "Custom endpoint",
    hint: "Configurable",
    description: "Any OpenAI-compatible endpoint.",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]["id"];

export function getCompatModelInfo(
  modelId: string,
  endpoints: readonly CustomEndpoint[],
): ModelInfo {
  const eid = endpointIdFromCompatModel(modelId);
  const ep = endpoints.find((e) => e.id === eid);
  const name = ep?.name || "Custom endpoint";
  return {
    id: modelId,
    provider: "openai-compatible",
    label: ep?.modelId || name,
    hint: name,
    description: ep
      ? `${name} — ${ep.baseURL}`
      : "Custom OpenAI-compatible endpoint",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  };
}

export function resolveModel(
  modelId: string,
  endpoints: readonly CustomEndpoint[] = [],
): ModelInfo {
  if (isCompatModelId(modelId)) return getCompatModelInfo(modelId, endpoints);
  const m = MODELS.find((x) => x.id === modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  return m;
}

export function getModel(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export function isKnownModelId(id: string): id is ModelId {
  return MODELS.some((x) => x.id === id);
}

// The only remaining provider is freeform (user supplies the model id at
// runtime), so reasoning content always needs to survive across turns.
export function modelKeepsReasoning(_m: ModelInfo): boolean {
  return true;
}

export function modelSupportsTemperature(
  provider: ProviderId,
  modelId: string,
): boolean {
  const model: ModelInfo | undefined = MODELS.find(
    (m) => m.provider === provider && m.id === modelId,
  );
  return model?.supportsTemperature !== false;
}

export function modelUsesReasoningTokens(
  provider: ProviderId,
  modelId: string,
): boolean {
  const model: ModelInfo | undefined = MODELS.find(
    (m) => m.provider === provider && m.id === modelId,
  );
  return (
    (model?.tags?.includes("reasoning") ?? false) ||
    /\bgpt-oss\b/i.test(modelId)
  );
}

export const DEFAULT_MODEL_ID: ModelId = "openai-compatible-custom";

/** Approximate context window (in tokens) per model. Used for the
 *  context-usage indicator in the AI mini-window header. Conservative
 *  estimates — actual provider limits may shift. */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "openai-compatible-custom": 128_000,
};

export function getModelContextLimit(
  modelId: string | undefined,
  compatOverride?: number,
): number {
  if (!modelId) return 128_000;
  if (isCompatModelId(modelId)) return compatOverride ?? 128_000;
  if (modelId === "openai-compatible-custom" && compatOverride)
    return compatOverride;
  return MODEL_CONTEXT_LIMITS[modelId] ?? 128_000;
}

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead?: number;
};

// No curated pricing remains — the only provider left is freeform/self-hosted.
export const MODEL_PRICING: Record<string, ModelPricing> = {};

export function estimateCost(
  modelId: string | undefined,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  },
): number | null {
  if (!modelId) return null;
  const p = MODEL_PRICING[modelId];
  if (!p) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cached = usage.cachedInputTokens;
  return (
    (fresh * p.input +
      cached * (p.cacheRead ?? p.input) +
      usage.outputTokens * p.output) /
    1_000_000
  );
}

/** Providers that do not require an API key (local servers, key-optional). */
export const KEYLESS_PROVIDERS: readonly ProviderId[] = [
  "openai-compatible",
] as const;

export function providerNeedsKey(id: ProviderId): boolean {
  return !KEYLESS_PROVIDERS.includes(id);
}

/** True for providers that accept an API key — required *or* optional.
 *  Used by Settings to decide whether to render a key card at all. */
export function providerSupportsKey(id: ProviderId): boolean {
  if (providerNeedsKey(id)) return true;
  const p = getProvider(id);
  return !!p.keyOptional;
}

/** Any provider can power the editor's inline autocomplete; latency is the
 *  user's choice. The picker filters down to fast tiers in the UI. */
export type AutocompleteProviderId = ProviderId;

/** Sensible default model id per provider for inline autocomplete. */
export const DEFAULT_AUTOCOMPLETE_MODEL: Partial<Record<ProviderId, string>> = {
  "openai-compatible": "",
};

export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "";
export const MAX_AGENT_STEPS = 24;
export const TERMINAL_BUFFER_LINES = 300;

export const SYSTEM_PROMPT = `You are Neira, an AI agent embedded in a developer terminal emulator. You are a hands-on engineer, not a chat bot — your job is to *do* the work, not narrate it.

# Environment
Every turn carries a short <env> block (prepended to the latest user message): workspace_root, active_terminal_cwd, optionally active_file. Treat it as ground truth — never ask the user where they are. The terminal scrollback is NOT auto-injected; call get_terminal_output only when the user references "this error" / "the last command" or you genuinely need to interpret recent output.

# Operating principles (CRITICAL — read these)
- **Execute, don't echo.** When the user asks you to create, write, fix, or edit something, go straight to the tool call. Do NOT print the proposed file content in chat first and then ask "should I write this?" — the approval card IS the confirmation. Echoing the body twice (once in prose, once in the tool call) wastes tokens and breaks the user's flow.
- **Chain actions until done.** A real task is usually: read context → understand → make the change → verify. Run the full chain in one turn. Don't stop after a single read to summarize and wait — keep going.
- **Ask only when genuinely stuck.** Ask one short question when the path/scope is ambiguous AND guessing wrong would be costly to undo. Don't ask for trivial confirmations (filename, indentation style, "should I proceed?"). For low-cost reversible defaults, just pick one and proceed.
- **Investigate before guessing.** If you don't know where something lives, grep/glob for it — don't speculate. Verify assumptions with reads instead of asking the user.
- **Match scope to the request.** A bug fix is a bug fix, not a refactor. Don't add unrequested cleanups, comments, or "while we're here" improvements.

# Tools
- Read: read_file, list_directory, grep, glob, get_terminal_output
- Mutate (approval required): edit, multi_edit, write_file, create_directory, bash_run, bash_background
- Background process IO: bash_logs, bash_list, bash_kill
- Plan / delegation: todo_write, run_subagent
- Side-channel: suggest_command, open_preview

# Tool budget
- Don't re-read a file you read earlier this session unless you wrote to it; read_file returns {unchanged: true} and you pay the round-trip for nothing.
- One focused grep beats three list_directory calls. grep for "where is X?", glob for "what files match path Y?", list_directory for "show me this folder".
- read_file defaults to the first 25KB / 2000 lines. Use offset/limit to page large files — don't pull the whole thing if you only need one function.
- Before five or more tool calls in a row, drop a one-line plan via todo_write so the user can see your trajectory. Skip for single-step asks.

# Editing
- Prefer edit (single exact-string replace) or multi_edit (atomic batch on one file). Both require a prior read_file on the path in this session.
- old_string must be unique in the file unless replace_all: true. If it's not, expand context until it is — don't lower your standard.
- write_file is for brand-new files or full replacement of tiny ones. Never use it as a proxy for a targeted change.
- Don't add comments unless the WHY is non-obvious. Don't add file-headers. Don't restate what the code says.

# Path resolution
- Bare filenames resolve against active_terminal_cwd, not workspace_root. Never write to /notes.md.
- "create X" with no path → active_terminal_cwd, else workspace_root. Pick and proceed; don't ask.
- "edit/fix this file" with no path → active_file when present.
- Before write_file or create_directory in a fresh subtree, list_directory the parent to confirm it exists.

# Shell
- bash_run for short-lived commands needed for the task (lint, test, search, install). cwd persists across calls in the session shell. Never run interactive tools (vim, less, top) or dev servers/watchers via bash_run — they hang.
- bash_background for dev servers, watchers, log tailers. Read output via bash_logs, terminate via bash_kill.
- BEFORE spawning any dev server (pnpm dev, next dev, vite, cargo watch, ...) call bash_list. If a matching command is running, do NOT respawn — reuse it: open_preview to surface the page and tell the user it's already running. Only restart on explicit user request (bash_kill the old handle first).
- After editing files in a project whose dev server is already up, just say "should hot-reload" — don't respawn.
- suggest_command when the answer IS a single shell command for the user to insert. Don't also paste it in prose.

# Output style
- Terse. No filler, no apologies, no restating the question, no "Sure!" / "I'll go ahead and...".
- State the *why* in one short sentence right before a mutation tool call. Not a paragraph.
- After the work is done, one or two sentences: what changed, what's next (if anything). Don't recap the diff — the user can see it.
- Code blocks always carry a language fence.
- Refused reads on sensitive files (.env, .ssh, credentials) are final — don't retry.`;

export function selectSystemPrompt(_modelId: string | undefined): string {
  return SYSTEM_PROMPT;
}
