import { describe, expect, it } from "vitest";
import { type Agent, BUILTIN_AGENTS, findAgent } from "./agents";

const custom: Agent = {
  id: "a-1",
  name: "Mine",
  description: "",
  instructions: "",
  icon: "spark",
  builtIn: false,
};

const all = [...BUILTIN_AGENTS, custom];

describe("BUILTIN_AGENTS", () => {
  it("all carry unique ids and the builtIn flag", () => {
    const ids = BUILTIN_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_AGENTS.every((a) => a.builtIn)).toBe(true);
  });

  it("Impact Analysis delegates to both explorer subagent types", () => {
    const impactAnalysis = BUILTIN_AGENTS.find(
      (a) => a.id === "builtin:impact-analysis",
    );
    expect(impactAnalysis).toBeDefined();
    expect(impactAnalysis?.instructions).toContain("github-explorer");
    expect(impactAnalysis?.instructions).toContain("atlassian-explorer");
    expect(impactAnalysis?.instructions).toContain("run_subagent");
  });

  it("Brainstorm never writes code and only writes NEIRA.md locally", () => {
    const brainstorm = BUILTIN_AGENTS.find((a) => a.id === "builtin:brainstorm");
    expect(brainstorm).toBeDefined();
    expect(brainstorm?.instructions).toContain("never write or edit code");
    expect(brainstorm?.instructions).toContain("refuse");
    expect(brainstorm?.instructions).toContain("NEIRA.md");
    expect(brainstorm?.instructions).not.toContain(".scratch/");
    expect(brainstorm?.instructions).not.toContain("docs/adr/");
  });

  it("Brainstorm publishes specs/ADRs to Confluence and an Epic + tickets to Jira, never falling back to a local file", () => {
    const brainstorm = BUILTIN_AGENTS.find((a) => a.id === "builtin:brainstorm");
    expect(brainstorm?.instructions).toContain("push_confluence");
    expect(brainstorm?.instructions).toContain("push_jira");
    expect(brainstorm?.instructions).toContain('kind: "spec"');
    expect(brainstorm?.instructions).toContain('kind: "adr"');
    expect(brainstorm?.instructions).toContain('kind: "epic"');
    expect(brainstorm?.instructions).toContain('kind: "task"');
    expect(brainstorm?.instructions).toContain("epicKey");
    expect(brainstorm?.instructions).toContain("blockedByKey");
    // ADR pushes come before the Spec push, so the Spec can link each ADR's
    // returned url instead of just naming it.
    const adrIndex = brainstorm?.instructions.indexOf('kind: "adr"') ?? -1;
    const specIndex = brainstorm?.instructions.indexOf('kind: "spec"') ?? -1;
    expect(adrIndex).toBeGreaterThan(-1);
    expect(adrIndex).toBeLessThan(specIndex);
    expect(brainstorm?.instructions).toContain("link each ADR's");
    expect(brainstorm?.instructions).toContain("do not fall back to a local file");
  });

  it("Brainstorm is the only built-in agent with a declared tool whitelist, including the two push tools", () => {
    const brainstorm = BUILTIN_AGENTS.find((a) => a.id === "builtin:brainstorm");
    expect(brainstorm?.allowedTools).toEqual([
      "read_file",
      "list_directory",
      "grep",
      "glob",
      "write_file",
      "edit",
      "run_subagent",
      "push_confluence",
      "push_jira",
    ]);
    const others = BUILTIN_AGENTS.filter((a) => a.id !== "builtin:brainstorm");
    expect(others.every((a) => a.allowedTools === undefined)).toBe(true);
  });
});

describe("findAgent", () => {
  it("returns the agent whose id matches", () => {
    expect(findAgent(all, "a-1")).toBe(custom);
  });

  it("falls back to the first builtin for a missing id", () => {
    expect(findAgent(all, "does-not-exist")).toBe(BUILTIN_AGENTS[0]);
  });

  it("falls back to the first builtin for null, undefined, or empty id", () => {
    expect(findAgent(all, null)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, undefined)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, "")).toBe(BUILTIN_AGENTS[0]);
  });
});
