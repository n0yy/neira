import type { ToolExecutionOptions } from "ai";

export const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

type NeedsApproval =
  | boolean
  | ((
      input: never,
      opts: ToolExecutionOptions,
    ) => boolean | PromiseLike<boolean>)
  | undefined;

/** Resolve a tool's `needsApproval` (boolean or function) to a plain boolean, for tests. */
export async function resolveApproval(na: NeedsApproval): Promise<boolean> {
  return typeof na === "function" ? na({} as never, toolOptions) : Boolean(na);
}
