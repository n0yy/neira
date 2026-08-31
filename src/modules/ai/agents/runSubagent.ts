import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, type ModelId } from "../config";
import {
  buildConfiguredLanguageModel,
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
} & LocalProviderConfig;

export type SubagentStep = {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
};

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
  steps: SubagentStep[];
};

function truncateForTrace(value: unknown): unknown {
  if (value === undefined) return value;
  let str: string;
  if (typeof value === "string") {
    str = value;
  } else {
    try {
      str = JSON.stringify(value) ?? String(value);
    } catch {
      // Circular references, BigInt, etc. — fall back to a best-effort
      // string rather than letting this throw and lose the whole trace
      // (and the already-successful summary) to the caller's catch block.
      str = String(value);
    }
  }
  if (str.length <= MAX_TRACE_FIELD_CHARS) return value;
  const preview = `${str.slice(0, MAX_TRACE_FIELD_CHARS)}… (truncated)`;
  return typeof value === "string" ? preview : { truncated: true, preview };
}

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  onStep,
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
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) tools[t] = readOnly[t];
  }

  // Resolve the SAME model the parent agent is using — including custom
  // OpenAI-compatible endpoints ("compat-<id>"), local providers (LM
  // Studio/MLX/Ollama), and OpenRouter overrides. `getModel()` only knows
  // the static catalog, so it threw "Unknown model" for anything else;
  // `buildConfiguredLanguageModel` is the same resolver the main chat loop
  // uses (see `runAgentStream` in lib/agent.ts).
  const model = await buildConfiguredLanguageModel(modelId, keys, local);

  const start = Date.now();
  let lastStepAt = start;
  const stepDurations: number[] = [];
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      const now = Date.now();
      stepDurations[step.stepNumber] = now - lastStepAt;
      lastStepAt = now;
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  const steps: SubagentStep[] = [];
  for (const step of result.steps ?? []) {
    const calls = step.toolCalls ?? [];
    // The AI SDK only times the step as a whole, not individual tool calls
    // within it. When a step makes several calls in parallel, split the
    // step's duration evenly rather than showing the same full duration on
    // every row (misleadingly implying each call alone took that long).
    const perCallDurationMs = calls.length
      ? (stepDurations[step.stepNumber] ?? 0) / calls.length
      : 0;
    for (const call of calls) {
      const toolResult = step.toolResults?.find(
        (r) => r.toolCallId === call.toolCallId,
      );
      steps.push({
        toolName: call.toolName,
        input: truncateForTrace(call.input),
        output: truncateForTrace(toolResult?.output),
        durationMs: Math.round(perCallDurationMs),
      });
    }
  }

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
    steps,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
