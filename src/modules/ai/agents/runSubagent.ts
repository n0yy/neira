import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, type ModelId } from "../config";
import {
  buildConfiguredLanguageModel,
  resolveReasoningProviderOptions,
  type LocalProviderConfig,
} from "../lib/agent";
import type { ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildAtlassianExploreTools } from "../tools/atlassianExplore";
import { buildFsTools } from "../tools/fs";
import { buildGithubExploreTools } from "../tools/githubExplore";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;
// Cap per-field size in the persisted step trace so a single huge tool
// input/output (e.g. read_file on a large file) can't bloat
// neira-sessions.json. The caller-facing summary is unaffected — this only
// truncates what the human-facing step trace stores.
const MAX_TRACE_FIELD_CHARS = 4000;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: string;
  toolContext: ToolContext;
  onStep?: (label: string) => void;
  /** Fired once per tool call, as soon as it finishes — before the whole
   * subagent run resolves — so the caller can mirror it into a live,
   * per-toolCallId trace. Emits the exact same SubagentStep that ends up in
   * the final `steps` array, so a live view and the persisted trace never
   * disagree. */
  onStepTrace?: (step: SubagentStep) => void;
} & LocalProviderConfig;

export type SubagentToolStep = {
  kind: "tool";
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
};

export type SubagentReasoningStep = {
  kind: "reasoning";
  text: string;
};

export type SubagentStep = SubagentToolStep | SubagentReasoningStep;

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
  steps: SubagentStep[];
};

function truncateForTrace(value: unknown): unknown {
  if (value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= MAX_TRACE_FIELD_CHARS) return value;
    return `${value.slice(0, MAX_TRACE_FIELD_CHARS)}… (truncated)`;
  }

  let str: string;
  try {
    str = JSON.stringify(value) ?? String(value);
  } catch {
    // Circular references, BigInt, etc. — this value can never be
    // JSON-serialized as-is, so replace it outright (not just when it's
    // over the length cap) rather than letting the original, still-unsafe
    // value flow into the persisted trace and blow up JSON.stringify again
    // when the whole session gets saved.
    return { truncated: true, preview: `${String(value)} (unserializable)` };
  }
  if (str.length <= MAX_TRACE_FIELD_CHARS) return value;
  return {
    truncated: true,
    preview: `${str.slice(0, MAX_TRACE_FIELD_CHARS)}… (truncated)`,
  };
}

type ToolExecuteFn = (input: unknown, options: { toolCallId: string }) => unknown;

// AI SDK step timing spans the whole model turn (reasoning/generation +
// waiting for the tool), not the tool call alone — see the `durationMs`
// this used to report. Wrapping each tool's own `execute` measures just
// its execution, keyed by toolCallId so onStepFinish can look up the real
// number instead of guessing from step-level timing.
function withPureTiming(
  toolDef: unknown,
  onDuration: (toolCallId: string, durationMs: number) => void,
): unknown {
  if (
    !toolDef ||
    typeof toolDef !== "object" ||
    typeof (toolDef as { execute?: unknown }).execute !== "function"
  ) {
    return toolDef;
  }
  const original = (toolDef as { execute: ToolExecuteFn }).execute;
  return {
    ...(toolDef as object),
    execute: async (input: unknown, options: { toolCallId: string }) => {
      const start = Date.now();
      try {
        return await original(input, options);
      } finally {
        onDuration(options.toolCallId, Date.now() - start);
      }
    },
  };
}

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  onStep,
  onStepTrace,
  ...local
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
    ...buildGithubExploreTools(toolContext),
    ...buildAtlassianExploreTools(toolContext),
  };
  const pureDurationMs = new Map<string, number>();
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) {
      tools[t] = withPureTiming(readOnly[t], (toolCallId, durationMs) => {
        pureDurationMs.set(toolCallId, durationMs);
      });
    }
  }

  // Resolve the SAME model the parent agent is using — including custom
  // OpenAI-compatible endpoints ("compat-<id>"). `getModel()` only knows
  // the static catalog, so it threw "Unknown model" for anything else;
  // `buildConfiguredLanguageModel` is the same resolver the main chat loop
  // uses (see `runAgentStream` in lib/agent.ts).
  const model = await buildConfiguredLanguageModel(modelId, keys, local);
  const reasoningProviderOptions = resolveReasoningProviderOptions(
    modelId,
    local,
  );

  const start = Date.now();
  const steps: SubagentStep[] = [];
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    ...(reasoningProviderOptions
      ? { providerOptions: reasoningProviderOptions }
      : {}),
    onStepFinish: (step) => {
      if (step.reasoningText) {
        const reasoningStep: SubagentStep = {
          kind: "reasoning",
          text: truncateForTrace(step.reasoningText) as string,
        };
        steps.push(reasoningStep);
        onStepTrace?.(reasoningStep);
      }

      const calls = step.toolCalls ?? [];
      for (const call of calls) {
        const toolResult = step.toolResults?.find(
          (r) => r.toolCallId === call.toolCallId,
        );
        const traceStep: SubagentStep = {
          kind: "tool",
          toolName: call.toolName,
          input: truncateForTrace(call.input),
          output: truncateForTrace(toolResult?.output),
          durationMs: pureDurationMs.get(call.toolCallId) ?? 0,
        };
        steps.push(traceStep);
        onStepTrace?.(traceStep);
      }

      if (onStep) {
        const last = calls[calls.length - 1];
        if (last) onStep(`${type}: ${last.toolName}`);
      }
    },
  });

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
    steps,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
