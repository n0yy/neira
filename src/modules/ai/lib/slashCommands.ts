import { CodeIcon, PencilEdit02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { useAgentsStore } from "../store/agentsStore";

/**
 * Outcome of intercepting a slash command from the composer.
 *
 * - `"handled"`: command ran; the composer should NOT send a chat message.
 * - `"send-prompt"`: replace the user's text with `prompt` and send normally.
 * - `"none"`: not a slash command; let the composer behave as usual.
 */
export type SlashOutcome =
  | { kind: "handled"; toast?: string }
  | { kind: "send-prompt"; prompt: string; commandName?: string }
  | { kind: "none" };

const INIT_PROMPT = `Scan this workspace and produce NEIRA.md at the workspace root with:

- One-paragraph project description.
- Build / test / dev commands.
- Architecture overview (subsystems, data flow, key dirs).
- Conventions worth knowing (naming, patterns, gotchas).
- Paths to entry points.

Use grep/glob/list_directory/read_file to explore. Cap NEIRA.md under 200 lines. Use write_file to create it (will go through normal approval).`;

const IMPLEMENT_WORKFLOW = `Then:
1. Check the current branch. If you're on main/master, create a new feature branch with a short, descriptive, generic name before starting. If you're already on a feature branch, keep working there.
2. Implement the work. Prefer test-first at the seams that matter: write a failing test before the implementation that makes it pass, where that's practical.
3. Run type-checking and the relevant single test file(s) regularly as you go. Run the project's full check suite (lint / type-check / test — discover the actual commands from NEIRA.md, package.json scripts, or similar; don't assume a specific package manager or that this is the Neira repo itself) once at the end.
4. Do not run a code-review pass — that's a separate step, run /code-review for it when wanted.
5. Commit the work to the current branch. If you worked off a ticket file under .scratch/, check off its completed acceptance criteria in that file before committing.`;

const ONE_TICKET_GUARD = `Implement ONLY that one spec or ticket. Never sweep or implement any other file under .scratch/, even ones sitting right next to it in the same issues/ folder.`;

function buildImplementPrompt(tail: string): string {
  if (!tail) {
    return `Implement the work already described in this conversation (a spec, a ticket, or explicit instructions from the user). If nothing here tells you what to build, stop and ask — don't guess at what "it" is.

${IMPLEMENT_WORKFLOW}`;
  }

  // A path (has a slash or a .md extension) always wins over slug/NN parsing,
  // so a relative path like "permission-modes/issues/03-foo.md" is read
  // directly instead of being misread as a one-token feature-slug.
  if (tail.includes("/") || tail.endsWith(".md")) {
    return `Read the file at "${tail}" with read_file — try it exactly as given first, and if that fails, retry with a leading ".scratch/" prepended. ${ONE_TICKET_GUARD}

${IMPLEMENT_WORKFLOW}`;
  }

  const [slug, num] = tail.split(/\s+/).filter(Boolean);

  if (!num) {
    return `Read .scratch/${slug}/. If spec.md exists there, implement the whole spec. If an issues/ directory exists instead, work the frontier: the lowest-numbered ticket file whose "Blocked by" list is fully satisfied (every blocker done or absent). ${ONE_TICKET_GUARD}

${IMPLEMENT_WORKFLOW}`;
  }

  return `Read .scratch/${slug}/issues/ and find the ticket file whose numeric prefix matches ${num} (it may be zero-padded, e.g. "0${num}-..." if under 10). ${ONE_TICKET_GUARD}

${IMPLEMENT_WORKFLOW}`;
}

const CODE_REVIEW_PROMPT = `Review the diff on this branch since it diverged from main (merge-base — not just the last commit), for correctness bugs and reuse/simplification/efficiency issues. Report findings ranked most-severe first, each with file:line, a one-sentence summary of the defect, and a concrete failure scenario that would trigger it. Verify each finding against the actual file before reporting it. If nothing real turns up, say so plainly — don't invent findings to fill space.`;

export type SlashCommandMeta = {
  name: string;
  invocation: string;
  label: string;
  icon: typeof SparklesIcon;
};

export const SLASH_COMMANDS: Record<string, SlashCommandMeta> = {
  init: {
    name: "init",
    invocation: "/init",
    label: "Initialize workspace",
    icon: SparklesIcon,
  },
  implement: {
    name: "implement",
    invocation: "/implement",
    label: "Implement spec or ticket",
    icon: CodeIcon,
  },
  "code-review": {
    name: "code-review",
    invocation: "/code-review",
    label: "Review the diff",
    icon: PencilEdit02Icon,
  },
};

export const NEIRA_CMD_RE =
  /^<neira-command\s+name="([a-z0-9-]+)"(?:\s+state="([a-z]+)")?\s*\/>(?:\n+|$)/;

export function wrapWithCommandMarker(prompt: string, name: string): string {
  return `<neira-command name="${name}" />\n\n${prompt}`;
}

export function tryRunSlashCommand(input: string): SlashOutcome {
  const trimmed = input.trim();
  const lead = trimmed[0];
  if (lead !== "/" && lead !== "#") return { kind: "none" };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  if (lead === "#" && !SLASH_COMMANDS[head]) return { kind: "none" };
  const tail = rest.join(" ").trim();

  switch (head) {
    case "init": {
      return {
        kind: "send-prompt",
        prompt: INIT_PROMPT,
        commandName: "init",
      };
    }
    case "implement": {
      useAgentsStore.getState().setActiveId("builtin:coder");
      return {
        kind: "send-prompt",
        prompt: buildImplementPrompt(tail),
        commandName: "implement",
      };
    }
    case "code-review": {
      useAgentsStore.getState().setActiveId("builtin:reviewer");
      return {
        kind: "send-prompt",
        prompt: CODE_REVIEW_PROMPT,
        commandName: "code-review",
      };
    }
    default:
      return { kind: "none" };
  }
}
