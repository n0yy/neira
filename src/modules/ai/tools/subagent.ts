import { tool, type JSONValue } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent, type SubagentStep } from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import type { ToolContext } from "./context";

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

type SubagentToolInput = {
  type: SubagentType;
  prompt: string;
  description?: string;
};

type SubagentToolOutput =
  | {
      type: SubagentType;
      description: string | undefined;
      summary: string;
      stepCount: number;
      durationMs: number;
      steps: SubagentStep[];
    }
  | { error: string; type: SubagentType };

export function buildSubagentTools(ctx: ToolContext) {
  return {
    run_subagent: tool<SubagentToolInput, SubagentToolOutput>({
      description: `Spawn an isolated subagent with its own restricted toolset and a fresh message history. Use when you need to delegate a self-contained read-only investigation (large search, code review, security audit) without polluting your own context. The subagent returns a single text summary; pick a 'type' that matches its job.

Types:
${TYPE_KEYS.map((k) => `- ${k}: ${SUBAGENTS[k].description}`).join("\n")}

Auto-executes (no approval) — subagents are read-only by design.`,
      inputSchema: z.object({
        type: z.enum(TYPE_KEYS),
        prompt: z
          .string()
          .describe(
            "Self-contained instruction. The subagent has no memory of prior conversation — include all relevant context.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short label shown in the chat UI for the spawn card."),
      }),
      execute: async ({ type, prompt, description }, { toolCallId }) => {
        const {
          apiKeys,
          selectedModelId,
          customEndpointKeys,
          patchAgentMeta,
          appendLiveSubagentStep,
          clearLiveSubagentTrace,
        } = useChatStore.getState();
        const prefs = usePreferencesStore.getState();
        try {
          const r = await runSubagent({
            type,
            prompt,
            keys: apiKeys,
            modelId: selectedModelId,
            toolContext: ctx,
            onStep: (label) => patchAgentMeta({ step: label }),
            onStepTrace: (step) => appendLiveSubagentStep(toolCallId, step),
            // Same model the parent is using — see runSubagent.ts for why
            // this can't just be `getModel(modelId)`.
            lmstudioBaseURL: prefs.lmstudioBaseURL,
            lmstudioModelId: prefs.lmstudioModelId,
            mlxBaseURL: prefs.mlxBaseURL,
            mlxModelId: prefs.mlxModelId,
            ollamaBaseURL: prefs.ollamaBaseURL,
            ollamaModelId: prefs.ollamaModelId,
            openaiCompatibleBaseURL: prefs.openaiCompatibleBaseURL,
            openaiCompatibleModelId: prefs.openaiCompatibleModelId,
            openrouterModelId: prefs.openrouterModelId,
            customEndpoints: prefs.customEndpoints,
            customEndpointKeys,
          });
          return {
            type,
            description,
            summary: r.summary,
            stepCount: r.stepCount,
            durationMs: r.durationMs,
            steps: r.steps,
          };
        } catch (e) {
          return { error: String(e), type };
        } finally {
          // Live steps only matter while the card has no `output` yet — the
          // moment this settles (success or error), the tool-call part's
          // own output (or errorText) is the source of truth. Drop the live
          // entry so it can't linger and disagree with it.
          clearLiveSubagentTrace(toolCallId);
        }
      },
      // The `steps` field on this tool's output is for the human-facing UI
      // only (see CONTEXT.md "Step trace" / ADR 0003) — it must never reach
      // the calling Agent's own context. Without this, the AI SDK's default
      // tool-output serialization sends the whole object (including the
      // full step trace) back to the model on every later turn, which is
      // exactly the context bloat run_subagent exists to avoid.
      toModelOutput: ({ output }) => {
        if ("error" in output) {
          return { type: "json", value: output as JSONValue };
        }
        const { steps: _steps, ...rest } = output;
        return { type: "json", value: rest as JSONValue };
      },
    }),
  } as const;
}
