import type { ModelMessage, SystemModelMessage } from "ai";

export type PreparedAgentPrompt = {
  system: SystemModelMessage[];
  messages: ModelMessage[];
};

export function prepareAgentPrompt(
  stableSystem: string,
  history: readonly ModelMessage[],
): PreparedAgentPrompt {
  const system: SystemModelMessage[] = [
    { role: "system", content: stableSystem },
  ];
  const messages = history.slice();
  return { system, messages };
}
