import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "@/modules/ai/config";

function secretAccessors(account: string) {
  return {
    async get(): Promise<string | null> {
      try {
        const v = await invoke<string | null>("secrets_get", {
          service: KEYRING_SERVICE,
          account,
        });
        return v && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },
    async set(value: string): Promise<void> {
      const trimmed = value.trim();
      if (!trimmed) throw new Error("Value is empty");
      await invoke("secrets_set", {
        service: KEYRING_SERVICE,
        account,
        password: trimmed,
      });
    },
    async clear(): Promise<void> {
      try {
        await invoke("secrets_delete", {
          service: KEYRING_SERVICE,
          account,
        });
      } catch {
        // already absent — fine
      }
    },
  };
}

const github = secretAccessors("github-integration-pat");
export const getGithubToken = github.get;
export const setGithubToken = github.set;
export const clearGithubToken = github.clear;

const atlassian = secretAccessors("atlassian-integration-token");
export const getAtlassianToken = atlassian.get;
export const setAtlassianToken = atlassian.set;
export const clearAtlassianToken = atlassian.clear;
