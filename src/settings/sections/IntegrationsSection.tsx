import { GithubRepoPicker } from "@/settings/components/GithubRepoPicker";
import {
  IntegrationCredentialCard,
  type IntegrationStatus,
} from "@/settings/components/IntegrationCredentialCard";
import { SectionHeader } from "@/settings/components/SectionHeader";
import {
  GithubApiError,
  listGithubRepos,
  validateGithubToken,
  type GithubRepo,
} from "@/modules/integrations/github";
import {
  clearGithubToken,
  getGithubToken,
  setGithubToken,
} from "@/modules/integrations/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setGithubSelectedRepos } from "@/modules/settings/store";
import { Github01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

export function IntegrationsSection() {
  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Integrations"
        description="Connect external services so their data is available as context. Credentials are stored in your OS keychain."
      />
      <div className="flex flex-col gap-3">
        <GithubIntegrationCard />
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
    const next = checked
      ? [...current, fullName]
      : current.filter((r) => r !== fullName);
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
      <GithubRepoPicker
        repos={repos}
        truncated={repoTruncated}
        loadError={repoLoadError}
        selected={selectedRepos}
        onToggle={toggleRepo}
      />
    </IntegrationCredentialCard>
  );
}
