import { tool } from "ai";
import { z } from "zod";
import {
  type AtlassianCredentials,
  plainTextToConfluenceStorage,
  upsertConfluencePage,
  upsertJiraIssue,
} from "@/modules/integrations/atlassian";
import { autoApprovesEdits } from "../lib/permissionMode";
import { loadAtlassianScope } from "./atlassianExplore";
import type { ToolContext } from "./context";

type TargetResolution =
  | { ok: true; creds: AtlassianCredentials; key: string }
  | { ok: false; error: string };

/**
 * Resolves which Confluence space / Jira project a push targets: the one
 * selected space/project if there's exactly one, the explicit key if the
 * caller passed one (validated against the selected list), otherwise an
 * error asking the caller to disambiguate.
 */
async function resolvePublishTarget(
  scopeKey: "spaces" | "projects",
  enabledKey: "confluenceEnabled" | "jiraEnabled",
  notEnabledError: string,
  kindLabel: string,
  explicitKey: string | undefined,
): Promise<TargetResolution> {
  const loaded = await loadAtlassianScope();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const enabled =
    enabledKey === "confluenceEnabled"
      ? loaded.scope.confluenceEnabled
      : loaded.scope.jiraEnabled;
  if (!enabled) return { ok: false, error: notEnabledError };
  const options = scopeKey === "spaces" ? loaded.scope.spaces : loaded.scope.projects;

  if (explicitKey) {
    if (!options.includes(explicitKey)) {
      return {
        ok: false,
        error: `"${explicitKey}" is not a connected ${kindLabel}: ${options.join(", ")}.`,
      };
    }
    return { ok: true, creds: loaded.scope.creds, key: explicitKey };
  }
  if (options.length === 1) {
    return { ok: true, creds: loaded.scope.creds, key: options[0] };
  }
  if (options.length === 0) {
    return {
      ok: false,
      error: `No ${kindLabel}s are selected in Settings → Integrations.`,
    };
  }
  return {
    ok: false,
    error: `Multiple ${kindLabel}s are selected (${options.join(", ")}) — pass the key to pick one.`,
  };
}

/**
 * Ordinary Agent tools (not context-isolated Subagent tools like
 * `atlassian_search_*`) — writing to Confluence/Jira needs the normal
 * approval-card flow, so `needsApproval` gates them the same way
 * `write_file`/`edit` are gated. See ADR 0006.
 */
export function buildAtlassianPublishTools(ctx: ToolContext) {
  return {
    push_confluence: tool({
      description:
        'Create or update a Confluence page for a spec or ADR Artifact. Decides create-vs-update by searching for the page\'s exact title first. Pages live under an auto-created "Specs" or "ADRs" parent page in the target space.',
      inputSchema: z.object({
        kind: z
          .enum(["spec", "adr"])
          .describe(
            '"spec" pages live under the "Specs" parent, "adr" pages under "ADRs".',
          ),
        title: z
          .string()
          .describe(
            'Exact page title — used both to find an existing page and to create a new one. Use "<feature-slug>" for a spec, "ADR-<NNNN>: <slug>" for an ADR.',
          ),
        content: z
          .string()
          .describe(
            "Page body, as plain text — separate paragraphs with a blank line. Not Confluence storage-format markup; it is converted automatically.",
          ),
        spaceKey: z
          .string()
          .optional()
          .describe(
            "Confluence space key. Only required when more than one space is selected in Settings → Integrations.",
          ),
      }),
      needsApproval: () => !autoApprovesEdits(ctx.getPermissionMode()),
      execute: async ({ kind, title, content, spaceKey }) => {
        const target = await resolvePublishTarget(
          "spaces",
          "confluenceEnabled",
          "Confluence is not enabled for this Atlassian connection.",
          "Confluence space",
          spaceKey,
        );
        if (!target.ok) return { error: target.error };
        try {
          return await upsertConfluencePage(target.creds, {
            spaceKey: target.key,
            kind,
            title,
            content: plainTextToConfluenceStorage(content),
          });
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    push_jira: tool({
      description:
        'Create or update a Jira Epic or Task issue Artifact. Decides create-vs-update by searching for the issue\'s exact summary first. "epic" needs just a summary/description. "task" needs an `epicKey` (sets Jira\'s `parent` field — team-managed projects only) and optionally a `blockedByKey` for a native "is blocked by" link to a previously-pushed sibling ticket.',
      inputSchema: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("epic"),
          summary: z
            .string()
            .describe(
              'Exact issue summary — used both to find an existing Epic and to create a new one. Use "<feature-slug>".',
            ),
          description: z
            .string()
            .describe("Epic description body, plain text."),
          projectKey: z
            .string()
            .optional()
            .describe(
              "Jira project key. Only required when more than one project is selected in Settings → Integrations.",
            ),
        }),
        z.object({
          kind: z.literal("task"),
          summary: z
            .string()
            .describe(
              'Exact issue summary — used both to find an existing issue and to create a new one. Use "[<feature-slug>] <ticket title>".',
            ),
          description: z
            .string()
            .describe("Issue description body, plain text."),
          epicKey: z
            .string()
            .describe(
              "Issue key of this ticket's Epic, from a prior kind: \"epic\" push_jira call. Sets Jira's parent field (team-managed projects only).",
            ),
          blockedByKey: z
            .string()
            .optional()
            .describe(
              "Issue key of a previously-pushed blocking ticket, if this one is blocked by it. Push tickets in ascending dependency order so the blocker already exists.",
            ),
          projectKey: z
            .string()
            .optional()
            .describe(
              "Jira project key. Only required when more than one project is selected in Settings → Integrations.",
            ),
        }),
      ]),
      needsApproval: () => !autoApprovesEdits(ctx.getPermissionMode()),
      execute: async (input) => {
        const target = await resolvePublishTarget(
          "projects",
          "jiraEnabled",
          "Jira is not enabled for this Atlassian connection.",
          "Jira project",
          input.projectKey,
        );
        if (!target.ok) return { error: target.error };
        try {
          return await upsertJiraIssue(
            target.creds,
            input.kind === "epic"
              ? {
                  kind: "epic",
                  projectKey: target.key,
                  summary: input.summary,
                  description: input.description,
                }
              : {
                  kind: "task",
                  projectKey: target.key,
                  summary: input.summary,
                  description: input.description,
                  epicKey: input.epicKey,
                  blockedByKey: input.blockedByKey,
                },
          );
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
