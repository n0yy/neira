import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";
import type { PermissionMode } from "../lib/permissionMode";
import type { ToolContext } from "./context";

vi.mock("@/modules/agents/store/managedAgentsStore", () => ({
  useManagedAgentsStore: {
    getState: () => ({ getBySessionId: () => undefined }),
  },
}));
vi.mock("@/modules/terminal", () => ({ writeToSession: () => true }));

import { vi } from "vitest";
import { buildManagedAgentTools } from "./agent";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(mode: PermissionMode): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
    getPermissionMode: () => mode,
  } as unknown as ToolContext;
}

type NeedsApproval =
  | boolean
  | ((input: never, opts: ToolExecutionOptions) => boolean | PromiseLike<boolean>)
  | undefined;

async function resolveApproval(na: NeedsApproval): Promise<boolean> {
  return typeof na === "function" ? na({} as never, toolOptions) : Boolean(na);
}

describe("spawn_coding_agent/send_to_agent needsApproval", () => {
  it("asks under manual, accept-edits, and plan", async () => {
    for (const mode of ["manual", "accept-edits", "plan"] as const) {
      const { spawn_coding_agent, send_to_agent } = buildManagedAgentTools(
        makeContext(mode),
      );
      expect(await resolveApproval(spawn_coding_agent.needsApproval)).toBe(
        true,
      );
      expect(await resolveApproval(send_to_agent.needsApproval)).toBe(true);
    }
  });

  it("does not ask under auto", async () => {
    const { spawn_coding_agent, send_to_agent } = buildManagedAgentTools(
      makeContext("auto"),
    );
    expect(await resolveApproval(spawn_coding_agent.needsApproval)).toBe(
      false,
    );
    expect(await resolveApproval(send_to_agent.needsApproval)).toBe(false);
  });
});
