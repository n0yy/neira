import { tool } from "ai";
import { z } from "zod";
import {
  type AtlassianCredentials,
  getConfluencePage,
  getJiraIssue,
  searchCql,
  searchJql,
} from "@/modules/integrations/atlassian";
import { getAtlassianToken } from "@/modules/integrations/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "./context";

type AtlassianScope = {
  creds: AtlassianCredentials;
  jiraEnabled: boolean;
  confluenceEnabled: boolean;
  projects: string[];
  spaces: string[];
};

const NOT_CONNECTED_ERROR =
  "Atlassian is not connected. Connect it in Settings → Integrations.";

/** Shared by `atlassianPublish.ts` — loading credentials + selected-project/space scope is identical for read and write tools. */
export async function loadAtlassianScope(): Promise<
  { ok: true; scope: AtlassianScope } | { ok: false; error: string }
> {
  const token = await getAtlassianToken();
  if (!token) return { ok: false, error: NOT_CONNECTED_ERROR };
  const {
    atlassianSite: site,
    atlassianEmail: email,
    atlassianJiraEnabled: jiraEnabled,
    atlassianConfluenceEnabled: confluenceEnabled,
    atlassianSelectedProjects: projects,
    atlassianSelectedSpaces: spaces,
  } = usePreferencesStore.getState();
  if (!site || !email) return { ok: false, error: NOT_CONNECTED_ERROR };
  return {
    ok: true,
    scope: { creds: { site, email, token }, jiraEnabled, confluenceEnabled, projects, spaces },
  };
}

/**
 * Tools available exclusively to the `atlassian-explorer` Subagent (see
 * `src/modules/ai/agents/registry.ts`) — not registered in the main chat
 * tool set, since the point of routing them through `run_subagent` is
 * context isolation from the parent conversation.
 */
export function buildAtlassianExploreTools(_ctx: ToolContext) {
  return {
    atlassian_search_jql: tool({
      description:
        "Search Jira issues using JQL. Scoped to the projects selected in Settings → Integrations.",
      inputSchema: z.object({
        jql: z
          .string()
          .describe(
            'JQL query, e.g. \'text ~ "login" AND status != Done\'. Do not include a project clause — it is added automatically.',
          ),
      }),
      execute: async ({ jql }) => {
        const loaded = await loadAtlassianScope();
        if (!loaded.ok) return { error: loaded.error };
        if (!loaded.scope.jiraEnabled) {
          return { error: "Jira is not enabled for this Atlassian connection." };
        }
        if (loaded.scope.projects.length === 0) {
          return {
            error: "No Jira projects are selected in Settings → Integrations.",
          };
        }
        try {
          const hits = await searchJql(loaded.scope.creds, jql, loaded.scope.projects);
          return { hits };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    atlassian_search_cql: tool({
      description:
        "Search Confluence pages using CQL. Scoped to the spaces selected in Settings → Integrations.",
      inputSchema: z.object({
        cql: z
          .string()
          .describe(
            'CQL query, e.g. \'text ~ "login flow"\'. Do not include a space clause — it is added automatically.',
          ),
      }),
      execute: async ({ cql }) => {
        const loaded = await loadAtlassianScope();
        if (!loaded.ok) return { error: loaded.error };
        if (!loaded.scope.confluenceEnabled) {
          return {
            error: "Confluence is not enabled for this Atlassian connection.",
          };
        }
        if (loaded.scope.spaces.length === 0) {
          return {
            error: "No Confluence spaces are selected in Settings → Integrations.",
          };
        }
        try {
          const hits = await searchCql(loaded.scope.creds, cql, loaded.scope.spaces);
          return { hits };
        } catch (e) {
          return { error: String(e) };
        }
      },
    })
  } as const;
}
