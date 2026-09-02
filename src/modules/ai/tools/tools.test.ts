import { describe, expect, it } from "vitest";
import type { PermissionMode } from "../lib/permissionMode";
import { buildTools } from "./tools";
import type { ToolContext } from "./context";

function makeContext(
  mode: PermissionMode,
  allowedTools?: readonly string[],
): ToolContext {
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
    getAgentAllowedTools: () => allowedTools,
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

  it("omits push_confluence/push_jira under Plan mode, since they declare needsApproval", () => {
    const planTools = buildTools(makeContext("plan"));
    expect(planTools).not.toHaveProperty("push_confluence");
    expect(planTools).not.toHaveProperty("push_jira");

    const manualTools = buildTools(makeContext("manual"));
    expect(manualTools).toHaveProperty("push_confluence");
    expect(manualTools).toHaveProperty("push_jira");
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

describe("buildTools agent whitelist", () => {
  it("is unrestricted when the context declares no whitelist (regression)", () => {
    const tools = buildTools(makeContext("manual"));
    expect(tools).toHaveProperty("bash_run");
    expect(tools).toHaveProperty("write_file");
  });

  it("filters the registry to exactly the declared whitelist", () => {
    const tools = buildTools(
      makeContext("manual", ["read_file", "grep", "write_file"]),
    );
    expect(Object.keys(tools).sort()).toEqual(
      ["grep", "read_file", "write_file"].sort(),
    );
  });

  it("applies before the Plan-mode omission, so a whitelisted mutating tool is still gone under Plan", () => {
    const tools = buildTools(
      makeContext("plan", ["read_file", "write_file"]),
    );
    expect(tools).toHaveProperty("read_file");
    expect(tools).not.toHaveProperty("write_file");
  });
});
