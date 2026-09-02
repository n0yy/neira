import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModelContextLimit,
  isCompatModelId,
  MAX_AGENT_STEPS,
  modelKeepsReasoning,
  providerNeedsKey,
  resolveModel,
  selectSystemPrompt,
  type CustomEndpoint,
  type ProviderId,
} from "../config";
import { buildTools, type ToolContext } from "../tools/tools";
import { compactModelMessagesDetailed } from "./compact";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { prepareAgentPrompt } from "./prompt";
import { createProxyFetch } from "./proxyFetch";
import {
  buildReasoningRequestFields,
  isReasoningConfigUsable,
  resolveActiveReasoningLevel,
  type ReasoningRequestFields,
} from "./reasoningEffort";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> =
  {
    read_file: (i) => `Reading ${shortPath(i.path)}`,
    list_directory: (i) => `Listing ${shortPath(i.path)}`,
    grep: (i) => `Grepping ${ellipsize(String(i.pattern ?? ""), 40)}`,
    glob: (i) => `Globbing ${ellipsize(String(i.pattern ?? ""), 40)}`,
    edit: (i) => `Editing ${shortPath(i.path)}`,
    multi_edit: (i) => `Editing ${shortPath(i.path)}`,
    write_file: (i) => `Writing ${shortPath(i.path)}`,
    create_directory: (i) => `Creating ${shortPath(i.path)}`,
    bash_run: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_background: (i) =>
      `Spawning ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_logs: () => `Reading logs`,
    bash_list: () => `Listing background processes`,
    bash_kill: () => `Stopping background process`,
    suggest_command: (i) =>
      `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
    todo_write: (i) =>
      `Updating plan (${Array.isArray(i.todos) ? i.todos.length : 0} items)`,
    run_subagent: (i) => `Spawning ${String(i.type ?? "subagent")} subagent`,
  };

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type BuildModelOptions = {
  modelIdOverride?: string;
  openaiCompatibleBaseURL?: string;
};

const modelCache = new Map<string, LanguageModel>();

export async function buildLanguageModel(
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
  customEndpointKey?: string | null,
): Promise<LanguageModel> {
  if (providerNeedsKey(provider) && !keys[provider]) {
    throw new Error(
      `No API key configured for ${provider}. Open Settings → AI to add one.`,
    );
  }
  const key = keys[provider] ?? "";
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const epKey = customEndpointKey ?? "";
  const cacheKey = `${provider} ${key} ${epKey} ${resolvedModelId} ${compatURL}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;

  if (!compatURL) {
    throw new Error(
      "OpenAI-compatible provider has no base URL. Set it in Settings → Models.",
    );
  }
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const built = createOpenAICompatible({
    name: "openai-compatible",
    baseURL: compatURL,
    apiKey: epKey || key || undefined,
    fetch: localProxyFetch,
    includeUsage: true,
  })(resolvedModelId);

  modelCache.set(cacheKey, built);
  return built;
}

export type LocalProviderConfig = {
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
};

export function buildConfiguredLanguageModel(
  modelId: string,
  keys: ProviderKeys,
  local: LocalProviderConfig = {},
): Promise<LanguageModel> {
  if (isCompatModelId(modelId)) {
    const eid = endpointIdFromCompatModel(modelId);
    const ep = local.customEndpoints?.find((e) => e.id === eid);
    if (!ep) throw new Error(`Custom endpoint not found: ${eid}`);
    if (!ep.modelId.trim()) {
      throw new Error(
        `${ep.name}: no model id set. Open Settings → Models.`,
      );
    }
    return buildLanguageModel(
      "openai-compatible",
      keys,
      ep.modelId.trim(),
      { openaiCompatibleBaseURL: ep.baseURL },
      local.customEndpointKeys?.[eid],
    );
  }
  const m = resolveModel(modelId);
  if (!local.openaiCompatibleModelId?.trim()) {
    throw new Error(
      "OpenAI-compatible: no model id set. Open Settings → Models.",
    );
  }
  return buildLanguageModel(
    m.provider,
    keys,
    local.openaiCompatibleModelId.trim(),
    { openaiCompatibleBaseURL: local.openaiCompatibleBaseURL },
  );
}

/**
 * Reasoning-effort providerOptions for the freeform/self-hosted named custom
 * endpoints, the only place with per-model reasoning config (see
 * reasoningEffort.ts). Returns undefined when there's no usable config.
 */
export function resolveReasoningProviderOptions(
  modelId: string,
  local: LocalProviderConfig,
): Record<string, ReasoningRequestFields> | undefined {
  if (!isCompatModelId(modelId)) return undefined;
  const eid = endpointIdFromCompatModel(modelId);
  const ep = local.customEndpoints?.find((e) => e.id === eid);
  const cfg = ep?.reasoning;

  if (!isReasoningConfigUsable(cfg)) return undefined;
  const level = resolveActiveReasoningLevel(cfg);
  return { "openai-compatible": buildReasoningRequestFields(cfg.shape, level) };
}

function buildStableSystem(
  modelId: string,
  persona: { name: string; instructions: string } | null,
  customInstructions: string | undefined,
  projectMemory: string | null,
): string {
  const base = selectSystemPrompt(modelId);
  const personaBlock = persona?.instructions.trim()
    ? `\n\n## ACTIVE AGENT — ${persona.name}\n${persona.instructions.trim()}`
    : "";
  const customBlock = customInstructions?.trim()
    ? `\n\n## USER CUSTOM INSTRUCTIONS — follow unless they conflict with safety rules above\n${customInstructions.trim()}`
    : "";
  const memoryBlock =
    projectMemory && projectMemory.trim().length > 0
      ? `\n\n## PROJECT — NEIRA.md\n${projectMemory.trim()}`
      : "";
  return `${base}${memoryBlock}${personaBlock}${customBlock}`;
}

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AgentUsageDelta = AgentUsage & {
  lastInputTokens: number;
  lastCachedTokens: number;
};

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

export type RunAgentOptions = {
  keys: ProviderKeys;
  modelId?: string;
  customInstructions?: string;
  agentPersona?: { name: string; instructions: string } | null;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onFinishMeta?: (info: { hitStepCap: boolean; finishReason: string }) => void;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleContextLimit?: number;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  projectMemory?: string | null;
  uiMessages: UIMessage[];
  abortSignal?: AbortSignal;
};

export async function runAgentStream(opts: RunAgentOptions) {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const localConfig: LocalProviderConfig = {
    openaiCompatibleBaseURL: opts.openaiCompatibleBaseURL,
    openaiCompatibleModelId: opts.openaiCompatibleModelId,
    customEndpoints: opts.customEndpoints,
    customEndpointKeys: opts.customEndpointKeys,
  };
  const model = await buildConfiguredLanguageModel(
    modelId,
    opts.keys,
    localConfig,
  );
  const reasoningProviderOptions = resolveReasoningProviderOptions(
    modelId,
    localConfig,
  );
  const endpoints = opts.customEndpoints ?? [];
  const info = resolveModel(modelId, endpoints);

  const stableSystem = buildStableSystem(
    modelId,
    opts.agentPersona ?? null,
    opts.customInstructions,
    opts.projectMemory ?? null,
  );

  const history = await convertToModelMessages(opts.uiMessages);
  const keepsReasoning = modelKeepsReasoning(info);
  const prunedHistory = pruneMessages({
    messages: history,
    reasoning: keepsReasoning ? "none" : "before-last-message",
    emptyMessages: "remove",
  });
  const compatCtxOverride = isCompatModelId(modelId)
    ? endpoints.find((e) => e.id === endpointIdFromCompatModel(modelId))
        ?.contextLimit
    : opts.openaiCompatibleContextLimit;
  const compact = compactModelMessagesDetailed(
    prunedHistory,
    getModelContextLimit(modelId, compatCtxOverride),
  );
  const compactedHistory = compact.messages;
  if (compact.compacted) {
    opts.onCompact?.({ droppedCount: compact.droppedCount });
  }

  const prompt = prepareAgentPrompt(stableSystem, compactedHistory);

  let stepsSeen = 0;
  return streamText({
    model,
    system: prompt.system,
    messages: prompt.messages,
    allowSystemInMessages: false,
    tools: buildTools(opts.toolContext),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    abortSignal: opts.abortSignal,
    ...(reasoningProviderOptions
      ? { providerOptions: reasoningProviderOptions }
      : {}),
    onStepFinish: (step) => {
      stepsSeen++;
      if (opts.onStep) {
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) {
          const label = TOOL_LABELS[last.toolName];
          opts.onStep(
            label
              ? label((last.input ?? {}) as Record<string, unknown>)
              : `Calling ${last.toolName}`,
          );
        } else if (step.text) {
          opts.onStep("Writing");
        }
      }
      if (opts.onUsage && step.usage) {
        const u = step.usage;
        const stepInput = u.inputTokens ?? 0;
        const stepCached = u.inputTokenDetails?.cacheReadTokens ?? 0;
        opts.onUsage({
          inputTokens: stepInput,
          outputTokens: u.outputTokens ?? 0,
          cachedInputTokens: stepCached,
          lastInputTokens: stepInput,
          lastCachedTokens: stepCached,
        });
      }
    },
    onFinish: (result) => {
      opts.onStep?.(null);
      const finishReason =
        (result as { finishReason?: string } | undefined)?.finishReason ?? "";
      opts.onFinishMeta?.({
        hitStepCap: stepsSeen >= MAX_AGENT_STEPS,
        finishReason,
      });
    },
  });
}

export { EMPTY_USAGE };
