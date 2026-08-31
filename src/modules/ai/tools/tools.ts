import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `bash_run`, `bash_background`) require explicit user approval — the
 *    AI SDK pauses on tool-call and
 *    surfaces a `tool-approval-request` part that the UI renders as a
 *    confirmation card. Which modes skip that card is decided per-tool by
 *    each tool's `needsApproval` (see `lib/permissionMode.ts`).
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *  - Under Plan mode, every tool that declares `needsApproval` is omitted
 *    from the registry below entirely — the model never sees them, rather
 *    than seeing them and being denied (see
 *    docs/adr/0004-plan-mode-omits-tools-from-registry.md). This is derived
 *    from each tool's own `needsApproval`, not a separately maintained list,
 *    so a new mutating tool is covered automatically the moment it declares
 *    `needsApproval`.
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  const tools = {
    ...buildFsTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
  };

  if (ctx.getPermissionMode() === "plan") {
    for (const [name, t] of Object.entries(tools)) {
      if (t.needsApproval) delete (tools as Record<string, unknown>)[name];
    }
  }

  return tools;
}

export type ChatTools = ReturnType<typeof buildTools>;
