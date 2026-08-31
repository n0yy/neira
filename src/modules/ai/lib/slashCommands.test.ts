import { beforeEach, describe, expect, it, vi } from "vitest";

const setActiveId = vi.hoisted(() => vi.fn());

vi.mock("../store/agentsStore", () => ({
  useAgentsStore: { getState: () => ({ setActiveId }) },
}));

import { tryRunSlashCommand } from "./slashCommands";

beforeEach(() => {
  setActiveId.mockClear();
});

describe("tryRunSlashCommand: /implement", () => {
  it("with no argument, works from conversation context and refuses to guess", () => {
    const outcome = tryRunSlashCommand("/implement");
    expect(outcome.kind).toBe("send-prompt");
    if (outcome.kind !== "send-prompt") throw new Error("unreachable");
    expect(outcome.prompt).toContain("already described in this conversation");
    expect(outcome.prompt).toContain("stop and ask");
    expect(outcome.commandName).toBe("implement");
  });

  it("switches the active agent to Coder", () => {
    tryRunSlashCommand("/implement");
    expect(setActiveId).toHaveBeenCalledWith("builtin:coder");
  });

  it("with a slug, reads .scratch/<slug>/ for a spec or the frontier ticket", () => {
    const outcome = tryRunSlashCommand("/implement permission-modes");
    if (outcome.kind !== "send-prompt") throw new Error("unreachable");
    expect(outcome.prompt).toContain(".scratch/permission-modes/");
    expect(outcome.prompt).toContain("spec.md");
    expect(outcome.prompt).toContain("frontier");
  });

  it("with a slug and ticket number, targets that ticket specifically", () => {
    const outcome = tryRunSlashCommand("/implement permission-modes 2");
    if (outcome.kind !== "send-prompt") throw new Error("unreachable");
    expect(outcome.prompt).toContain(".scratch/permission-modes/issues/");
    expect(outcome.prompt).toContain("matches 2");
    expect(outcome.prompt).not.toContain("work the frontier");
  });

  it("always includes the shared workflow (branch check, no review, commit)", () => {
    const outcome = tryRunSlashCommand("/implement");
    if (outcome.kind !== "send-prompt") throw new Error("unreachable");
    expect(outcome.prompt).toContain("main/master");
    expect(outcome.prompt).toContain("Do not run a code-review pass");
    expect(outcome.prompt).toContain("Commit the work");
  });
});

describe("tryRunSlashCommand: /code-review", () => {
  it("reviews the diff since merge-base with main, no arguments needed", () => {
    const outcome = tryRunSlashCommand("/code-review");
    expect(outcome.kind).toBe("send-prompt");
    if (outcome.kind !== "send-prompt") throw new Error("unreachable");
    expect(outcome.prompt).toContain("merge-base");
    expect(outcome.commandName).toBe("code-review");
  });

  it("switches the active agent to Code Reviewer", () => {
    tryRunSlashCommand("/code-review");
    expect(setActiveId).toHaveBeenCalledWith("builtin:reviewer");
  });

  it("ignores any trailing text, same as /init", () => {
    const withArg = tryRunSlashCommand("/code-review main");
    const withoutArg = tryRunSlashCommand("/code-review");
    if (withArg.kind !== "send-prompt" || withoutArg.kind !== "send-prompt") {
      throw new Error("unreachable");
    }
    expect(withArg.prompt).toBe(withoutArg.prompt);
  });
});

describe("tryRunSlashCommand: unknown/non-command input", () => {
  it("returns none for plain text", () => {
    expect(tryRunSlashCommand("just a normal message")).toEqual({
      kind: "none",
    });
  });

  it("returns none for an unknown # command", () => {
    expect(tryRunSlashCommand("#not-a-real-command")).toEqual({
      kind: "none",
    });
  });

  it("returns none for an unknown / command", () => {
    expect(tryRunSlashCommand("/not-a-real-command")).toEqual({
      kind: "none",
    });
  });
});
