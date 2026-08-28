import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "@/modules/ai/config";

const GITHUB_ACCOUNT = "github-integration-pat";

export async function getGithubToken(): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: GITHUB_ACCOUNT,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setGithubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: GITHUB_ACCOUNT,
    password: trimmed,
  });
}

export async function clearGithubToken(): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: GITHUB_ACCOUNT,
    });
  } catch {
    // already absent — fine
  }
}
