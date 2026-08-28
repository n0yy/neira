import {
  IntegrationCredentialCard,
  type IntegrationStatus,
} from "@/settings/components/IntegrationCredentialCard";
import { IntegrationItemPicker } from "@/settings/components/IntegrationItemPicker";
import { SectionHeader } from "@/settings/components/SectionHeader";
import { Switch } from "@/components/ui/switch";
import {
  AtlassianApiError,
  filterAtlassianItems,
  listConfluenceSpaces,
  listJiraProjects,
  validateAtlassianCredentials,
  type AtlassianCredentials,
  type ConfluenceSpace,
  type JiraProject,
} from "@/modules/integrations/atlassian";
import {
  filterRepos,
  GithubApiError,
  listGithubRepos,
  validateGithubToken,
  type GithubRepo,
} from "@/modules/integrations/github";
import {
  clearAtlassianToken,
  clearGithubToken,
  getAtlassianToken,
  getGithubToken,
  setAtlassianToken,
  setGithubToken,
} from "@/modules/integrations/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAtlassianConfluenceEnabled,
  setAtlassianEmail,
  setAtlassianJiraEnabled,
  setAtlassianSelectedProjects,
  setAtlassianSelectedSpaces,
  setAtlassianSite,
  setGithubSelectedRepos,
} from "@/modules/settings/store";
import { Github01Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

/** Applies a checkbox toggle to a selection list without mutating it. */
function nextSelection(
  current: readonly string[],
  item: string,
  checked: boolean,
): string[] {
  return checked ? [...current, item] : current.filter((v) => v !== item);
}

export function IntegrationsSection() {
  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Integrations"
        description="Connect external services so their data is available as context. Credentials are stored in your OS keychain."
      />
      <div className="flex flex-col gap-3">
        <GithubIntegrationCard />
        <AtlassianIntegrationCard />
      </div>
    </div>
  );
}

/**
 * Module-level so the repo list survives the Integrations tab being switched
 * away from and back to — otherwise every remount re-issues up to
 * MAX_REPO_PAGES GitHub API requests for data that hasn't changed.
 */
let repoCache: { token: string; repos: GithubRepo[] } | null = null;

function GithubIntegrationCard() {
  const selectedRepos = usePreferencesStore((s) => s.githubSelectedRepos);

  const [status, setStatus] = useState<IntegrationStatus>("disconnected");
  const [login, setLogin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [repoTruncated, setRepoTruncated] = useState(false);
  const [repoLoadError, setRepoLoadError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getGithubToken().then((t) => {
      if (cancelled) return;
      setToken(t);
      setStatus(t ? "connected" : "disconnected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "connected" || !token || repos !== null) return;
    if (repoCache?.token === token) {
      setRepos(repoCache.repos);
      return;
    }
    let cancelled = false;
    void listGithubRepos(token)
      .then((r) => {
        if (cancelled) return;
        repoCache = { token, repos: r.repos };
        setRepos(r.repos);
        setRepoTruncated(r.truncated);
      })
      .catch((e) => {
        if (!cancelled) {
          setRepoLoadError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, token, repos]);

  const connect = async (values: Record<string, string>) => {
    setStatus("validating");
    setError(null);
    try {
      const user = await validateGithubToken(values.token);
      await setGithubToken(values.token);
      setToken(values.token);
      setLogin(user.login);
      setStatus("connected");
    } catch (e) {
      setStatus("invalid");
      setError(
        e instanceof GithubApiError || e instanceof Error
          ? e.message
          : "Could not connect to GitHub.",
      );
    }
  };

  const disconnect = async () => {
    await clearGithubToken();
    await setGithubSelectedRepos([]);
    repoCache = null;
    setToken(null);
    setLogin(null);
    setRepos(null);
    setRepoTruncated(false);
    setRepoLoadError(null);
    setStatus("disconnected");
  };

  const toggleRepo = (fullName: string, checked: boolean) => {
    // Read the latest store snapshot rather than the closed-over
    // `selectedRepos` — persisting a preference round-trips through the
    // Tauri store before this hook's value updates, so two rapid toggles
    // would otherwise both compute from the same stale array and the
    // second write would clobber the first.
    const current = usePreferencesStore.getState().githubSelectedRepos;
    const next = nextSelection(current, fullName, checked);
    usePreferencesStore.setState({ githubSelectedRepos: next });
    void setGithubSelectedRepos(next);
  };

  return (
    <IntegrationCredentialCard
      icon={<HugeiconsIcon icon={Github01Icon} size={15} strokeWidth={1.5} />}
      title="GitHub"
      description="Connect a GitHub account via Personal Access Token, then choose which repos to scope this integration to."
      docsUrl="https://github.com/settings/tokens"
      fields={[
        {
          key: "token",
          label: "Personal Access Token",
          type: "password",
          placeholder: "ghp_…",
        },
      ]}
      status={status}
      statusDetail={
        status === "connected"
          ? login
            ? `Connected as ${login}`
            : "Connected"
          : status === "invalid"
            ? error
            : null
      }
      onConnect={connect}
      onDisconnect={disconnect}
    >
      <IntegrationItemPicker
        title="Repositories"
        items={repos}
        truncated={repoTruncated}
        loadError={repoLoadError}
        selected={selectedRepos}
        filter={filterRepos}
        getKey={(r) => r.fullName}
        renderItem={(r) => (
          <>
            <span className="truncate font-mono">{r.fullName}</span>
            {r.private ? (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                private
              </span>
            ) : null}
          </>
        )}
        onToggle={toggleRepo}
      />
    </IntegrationCredentialCard>
  );
}

function AtlassianProductToggles() {
  const jiraEnabled = usePreferencesStore((s) => s.atlassianJiraEnabled);
  const confluenceEnabled = usePreferencesStore(
    (s) => s.atlassianConfluenceEnabled,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-2 text-[11.5px]">
        <span>Jira</span>
        <Switch
          checked={jiraEnabled}
          onCheckedChange={(v) => void setAtlassianJiraEnabled(v)}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-[11.5px]">
        <span>Confluence</span>
        <Switch
          checked={confluenceEnabled}
          onCheckedChange={(v) => void setAtlassianConfluenceEnabled(v)}
        />
      </label>
    </div>
  );
}

/** Module-level cache, same rationale as `repoCache` above. */
let projectCache: { key: string; items: JiraProject[] } | null = null;
let spaceCache: { key: string; items: ConfluenceSpace[] } | null = null;

function atlassianCacheKey(creds: AtlassianCredentials): string {
  return `${creds.site}::${creds.token}`;
}

function AtlassianIntegrationCard() {
  const site = usePreferencesStore((s) => s.atlassianSite);
  const email = usePreferencesStore((s) => s.atlassianEmail);
  const jiraEnabled = usePreferencesStore((s) => s.atlassianJiraEnabled);
  const confluenceEnabled = usePreferencesStore(
    (s) => s.atlassianConfluenceEnabled,
  );
  const selectedProjects = usePreferencesStore(
    (s) => s.atlassianSelectedProjects,
  );
  const selectedSpaces = usePreferencesStore((s) => s.atlassianSelectedSpaces);

  const [status, setStatus] = useState<IntegrationStatus>("disconnected");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [projectsTruncated, setProjectsTruncated] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [spaces, setSpaces] = useState<ConfluenceSpace[] | null>(null);
  const [spacesTruncated, setSpacesTruncated] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAtlassianToken().then((t) => {
      if (cancelled) return;
      setToken(t);
      setStatus(t ? "connected" : "disconnected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      status !== "connected" ||
      !token ||
      !site ||
      !email ||
      !jiraEnabled ||
      projects !== null
    ) {
      return;
    }
    const creds = { site, email, token };
    const key = atlassianCacheKey(creds);
    if (projectCache?.key === key) {
      setProjects(projectCache.items);
      return;
    }
    let cancelled = false;
    void listJiraProjects(creds)
      .then((r) => {
        if (cancelled) return;
        projectCache = { key, items: r.items };
        setProjects(r.items);
        setProjectsTruncated(r.truncated);
      })
      .catch((e) => {
        if (!cancelled) {
          setProjectsError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, token, site, email, jiraEnabled, projects]);

  useEffect(() => {
    if (
      status !== "connected" ||
      !token ||
      !site ||
      !email ||
      !confluenceEnabled ||
      spaces !== null
    ) {
      return;
    }
    const creds = { site, email, token };
    const key = atlassianCacheKey(creds);
    if (spaceCache?.key === key) {
      setSpaces(spaceCache.items);
      return;
    }
    let cancelled = false;
    void listConfluenceSpaces(creds)
      .then((r) => {
        if (cancelled) return;
        spaceCache = { key, items: r.items };
        setSpaces(r.items);
        setSpacesTruncated(r.truncated);
      })
      .catch((e) => {
        if (!cancelled) {
          setSpacesError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, token, site, email, confluenceEnabled, spaces]);

  const connect = async (values: Record<string, string>) => {
    setStatus("validating");
    setError(null);
    const creds: AtlassianCredentials = {
      site: values.site,
      email: values.email,
      token: values.token,
    };
    try {
      const user = await validateAtlassianCredentials(creds, {
        jira: jiraEnabled,
        confluence: confluenceEnabled,
      });
      await Promise.all([
        setAtlassianToken(creds.token),
        setAtlassianSite(creds.site),
        setAtlassianEmail(creds.email),
      ]);
      setToken(creds.token);
      setDisplayName(user.displayName);
      setStatus("connected");
    } catch (e) {
      setStatus("invalid");
      setError(
        e instanceof AtlassianApiError || e instanceof Error
          ? e.message
          : "Could not connect to Atlassian.",
      );
    }
  };

  const disconnect = async () => {
    await Promise.all([
      clearAtlassianToken(),
      setAtlassianSite(""),
      setAtlassianEmail(""),
      setAtlassianSelectedProjects([]),
      setAtlassianSelectedSpaces([]),
    ]);
    projectCache = null;
    spaceCache = null;
    setToken(null);
    setDisplayName(null);
    setProjects(null);
    setProjectsTruncated(false);
    setProjectsError(null);
    setSpaces(null);
    setSpacesTruncated(false);
    setSpacesError(null);
    setStatus("disconnected");
  };

  const toggleProject = (key: string, checked: boolean) => {
    const current = usePreferencesStore.getState().atlassianSelectedProjects;
    const next = nextSelection(current, key, checked);
    usePreferencesStore.setState({ atlassianSelectedProjects: next });
    void setAtlassianSelectedProjects(next);
  };

  const toggleSpace = (key: string, checked: boolean) => {
    const current = usePreferencesStore.getState().atlassianSelectedSpaces;
    const next = nextSelection(current, key, checked);
    usePreferencesStore.setState({ atlassianSelectedSpaces: next });
    void setAtlassianSelectedSpaces(next);
  };

  return (
    <IntegrationCredentialCard
      icon={
        <HugeiconsIcon icon={LinkSquare01Icon} size={15} strokeWidth={1.5} />
      }
      title="Atlassian (Jira & Confluence)"
      description="Connect one Atlassian Cloud account via API token, then choose which Jira projects and Confluence spaces to scope this integration to."
      docsUrl="https://id.atlassian.com/manage-profile/security/api-tokens"
      fields={[
        {
          key: "site",
          label: "Site URL",
          placeholder: "yourteam.atlassian.net",
        },
        { key: "email", label: "Email", placeholder: "you@company.com" },
        { key: "token", label: "API Token", type: "password" },
      ]}
      status={status}
      statusDetail={
        status === "connected"
          ? displayName
            ? `Connected as ${displayName}`
            : "Connected"
          : status === "invalid"
            ? error
            : null
      }
      onConnect={connect}
      onDisconnect={disconnect}
      formExtra={<AtlassianProductToggles />}
    >
      <div className="flex flex-col gap-3">
        <AtlassianProductToggles />
        {jiraEnabled ? (
          <IntegrationItemPicker
            title="Jira projects"
            items={projects}
            truncated={projectsTruncated}
            loadError={projectsError}
            selected={selectedProjects}
            filter={filterAtlassianItems}
            getKey={(p) => p.key}
            renderItem={(p) => (
              <>
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {p.key}
                </span>
              </>
            )}
            onToggle={toggleProject}
          />
        ) : null}
        {confluenceEnabled ? (
          <IntegrationItemPicker
            title="Confluence spaces"
            items={spaces}
            truncated={spacesTruncated}
            loadError={spacesError}
            selected={selectedSpaces}
            filter={filterAtlassianItems}
            getKey={(s) => s.key}
            renderItem={(s) => (
              <>
                <span className="truncate">{s.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {s.key}
                </span>
              </>
            )}
            onToggle={toggleSpace}
          />
        ) : null}
      </div>
    </IntegrationCredentialCard>
  );
}
