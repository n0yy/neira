import { tool } from "ai";
import { z } from "zod";
import { getFileContents, searchCode, searchIssuesAndPrs } from "@/modules/integrations/github";
import { getGithubToken } from "@/modules/integrations/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "./context";

type GithubScope = { token: string; repos: string[] };

async function loadGithubScope(): Promise<
  { ok: true; scope: GithubScope } | { ok: false; error: string }
> {
  const token = await getGithubToken();
  if (!token) {
    return {
      ok: false,
      error: "GitHub is not connected. Connect it in Settings → Integrations.",
    };
  }
  const repos = usePreferencesStore.getState().githubSelectedRepos;
  if (repos.length === 0) {
    return {
      ok: false,
      error: "No GitHub repos are selected in Settings → Integrations.",
    };
  }
  return { ok: true, scope: { token, repos } };
}

/**
 * Tools available exclusively to the `github-explorer` Subagent (see
 * `src/modules/ai/agents/registry.ts`) — not registered in the main chat
 * tool set, since the point of routing them through `run_subagent` is
 * context isolation from the parent conversation.
 */
export function buildGithubExploreTools(_ctx: ToolContext) {
  return {
    github_search_code: tool({
      description:
        "Search code across the user's connected GitHub repos. Returns matching files with highlighted snippet fragments. Scoped to the repos selected in Settings → Integrations.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "GitHub code search query, e.g. 'useAuthStore' or 'function login language:ts'.",
          ),
      }),
      execute: async ({ query }) => {
        const loaded = await loadGithubScope();
        if (!loaded.ok) return { error: loaded.error };
        try {
          const hits = await searchCode(
            loaded.scope.token,
            query,
            loaded.scope.repos,
          );
          return { hits };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    github_search_issues_and_prs: tool({
      description:
        "Search issues and pull requests across the user's connected GitHub repos. Scoped to the repos selected in Settings → Integrations.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "GitHub search query for issues/PRs, e.g. 'authentication bug is:issue' or 'login is:pr is:open'.",
          ),
      }),
      execute: async ({ query }) => {
        const loaded = await loadGithubScope();
        if (!loaded.ok) return { error: loaded.error };
        try {
          const hits = await searchIssuesAndPrs(
            loaded.scope.token,
            query,
            loaded.scope.repos,
          );
          return { hits };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    github_get_file_contents: tool({
      description:
        "Read a single file's full contents from one of the user's connected GitHub repos. Use after a search hit needs more context than its snippet gives.",
      inputSchema: z.object({
        repo: z
          .string()
          .describe(
            "'owner/name' — must be one of the repos connected in Settings → Integrations.",
          ),
        path: z.string().describe("File path within the repo."),
        ref: z
          .string()
          .optional()
          .describe(
            "Branch, tag, or commit SHA. Defaults to the repo's default branch.",
          ),
      }),
      execute: async ({ repo, path, ref }) => {
        const loaded = await loadGithubScope();
        if (!loaded.ok) return { error: loaded.error };
        if (!loaded.scope.repos.includes(repo)) {
          return {
            error: `"${repo}" is not one of the connected repos: ${loaded.scope.repos.join(", ")}.`,
          };
        }
        try {
          const file = await getFileContents(loaded.scope.token, repo, path, ref);
          return file;
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
