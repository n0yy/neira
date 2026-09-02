/**
 * Per-model "reasoning effort" configuration for named custom OpenAI-compatible
 * endpoints. Self-hosted/proxied backends don't share a standard way to
 * control thinking effort: each expects its own request-body shape, so the
 * user defines exactly which levels their model supports and how to send
 * them, rather than picking from a fixed Neira-defined vocabulary.
 */

export type ReasoningShape = "flat" | "chat-template-kwargs" | "openrouter";

export type ReasoningConfig = {
  enabled: boolean;
  shape: ReasoningShape;
  /** User-defined level names, in the exact vocabulary the backend expects (e.g. "low"/"medium"/"xhigh"). */
  levels: string[];
  /** Which level is sent automatically for a model that's never been touched from the quick switcher. */
  defaultLevel: string;
  /** The level currently in effect for this model; persists across sessions. */
  activeLevel: string;
};

export const REASONING_SHAPES: readonly {
  value: ReasoningShape;
  label: string;
  hint?: string;
}[] = [
  { value: "flat", label: "Flat reasoning_effort" },
  {
    value: "chat-template-kwargs",
    label: "chat_template_kwargs (llama.cpp)",
    hint: "A proxy in front of your backend (e.g. LiteLLM) commonly strips this field silently: the request still succeeds, the level is just ignored. Try Flat first and confirm it actually changes the response before assuming this one is applied.",
  },
  { value: "openrouter", label: "OpenRouter reasoning.effort" },
];

export function emptyReasoningConfig(): ReasoningConfig {
  return { enabled: false, shape: "flat", levels: [], defaultLevel: "", activeLevel: "" };
}

/** True when a config is turned on and has at least one usable level. */
export function isReasoningConfigUsable(
  cfg: ReasoningConfig | null | undefined,
): cfg is ReasoningConfig {
  return !!cfg && cfg.enabled && cfg.levels.length > 0;
}

/** The level to actually send: the remembered active pick if still valid, else the configured default, else the first level. */
export function resolveActiveReasoningLevel(cfg: ReasoningConfig): string {
  if (cfg.activeLevel && cfg.levels.includes(cfg.activeLevel)) {
    return cfg.activeLevel;
  }
  if (cfg.defaultLevel && cfg.levels.includes(cfg.defaultLevel)) {
    return cfg.defaultLevel;
  }
  return cfg.levels[0] ?? "";
}

export type ReasoningRequestFields =
  | { reasoning_effort: string }
  | { chat_template_kwargs: { reasoning_effort: string } }
  | { reasoning: { effort: string } };

/** Serializes a level into the extra request-body fields for the given delivery shape. */
export function buildReasoningRequestFields(
  shape: ReasoningShape,
  level: string,
): ReasoningRequestFields {
  switch (shape) {
    case "flat":
      return { reasoning_effort: level };
    case "chat-template-kwargs":
      return { chat_template_kwargs: { reasoning_effort: level } };
    case "openrouter":
      return { reasoning: { effort: level } };
  }
}
