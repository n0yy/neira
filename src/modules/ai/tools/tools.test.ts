import { describe, expect, it } from "vitest";
import type { PermissionMode } from "../lib/permissionMode";
import { buildTools } from "./tools";
import type { ToolContext } from "./context";

function makeContext(mode: PermissionMode): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    readCache: new Map(),
    getSessionId: () => "session",
    getPermissionMode: () => mode,
  } as unknown as ToolContext;
}

const READ_ONLY_SURVIVORS = [
  "read_file",
  "list_directory",
  "grep",
  "glob",
  "todo_write",
] as const;

describe("buildTools under Plan mode", () => {
  it("keeps read-only and todo tools available", () => {
    const tools = buildTools(makeContext("plan"));
    for (const name of READ_ONLY_SURVIVORS) {
      expect(tools).toHaveProperty(name);
    }
  });
});

describe("buildTools outside Plan mode", () => {
  it("restores the full registry after switching out of plan", () => {
    const planTools = buildTools(makeContext("plan"));
    expect(planTools).not.toHaveProperty("write_file");

    const manualTools = buildTools(makeContext("manual"));
    expect(manualTools).toHaveProperty("write_file");
  });
});

describe("buildTools Plan omission is self-deriving", () => {
  it("omits exactly the tools that declare needsApproval under manual, no more and no less", () => {
    const manualTools = buildTools(makeContext("manual"));
    const declaredApproval = Object.entries(manualTools)
      .filter(([, t]) => Boolean((t as { needsApproval?: unknown }).needsApproval))
      .map(([name]) => name)
      .sort();

    const planTools = buildTools(makeContext("plan"));
    const missingUnderPlan = Object.keys(manualTools)
      .filter((name) => !(name in planTools))
      .sort();

    expect(missingUnderPlan).toEqual(declaredApproval);
  });
});
