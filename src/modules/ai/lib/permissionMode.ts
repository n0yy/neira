import { LazyStore } from "@tauri-apps/plugin-store";

export type PermissionMode = "manual" | "accept-edits" | "auto" | "plan";

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "manual",
  "accept-edits",
  "auto",
  "plan",
];

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  manual: "Manual",
  "accept-edits": "Accept Edits",
  auto: "Auto",
  plan: "Plan",
};

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  manual: "Every mutating tool call asks for approval.",
  "accept-edits":
    "File edits apply without asking. Shell and agent calls still ask.",
  auto: "Every mutating tool call runs without asking.",
  plan: "Read-only. Mutating tools are unavailable.",
};

/** True when the given mode auto-approves file-mutating tools (write_file, create_directory, edit, multi_edit). */
export function autoApprovesEdits(mode: PermissionMode): boolean {
  return mode === "accept-edits" || mode === "auto";
}

/** True when the given mode auto-approves every mutating tool, including shell and managed-agent calls. */
export function autoApprovesEverything(mode: PermissionMode): boolean {
  return mode === "auto";
}

/**
 * Every tool that currently declares `needsApproval`, kept here only as an
 * explicit fixture for tests. `buildTools` (tools.ts) does NOT read this —
 * it derives the Plan-mode omission live from each tool's own
 * `needsApproval`, so this list has no bearing on runtime behavior. Update
 * it when a tool's approval story changes, so the tests keep documenting
 * the true set.
 */
export const MUTATING_TOOL_NAMES = [
  "write_file",
  "create_directory",
  "edit",
  "multi_edit",
  "bash_run",
  "bash_background",
  "spawn_coding_agent",
  "send_to_agent",
] as const;

const STORE_PATH = "neira-permission-mode.json";
const KEY_MODE = "mode";
const KEY_SKIP_AUTO_CONFIRM = "skipAutoConfirm";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === "string" && (PERMISSION_MODES as string[]).includes(v);
}

export async function loadPermissionMode(): Promise<PermissionMode> {
  const mode = await store.get<PermissionMode>(KEY_MODE);
  return isPermissionMode(mode) ? mode : "manual";
}

export async function savePermissionMode(mode: PermissionMode): Promise<void> {
  await store.set(KEY_MODE, mode);
  await store.save();
}

/** Whether the user opted out of the one-time confirmation before entering Auto mode. */
export async function loadSkipAutoConfirm(): Promise<boolean> {
  return (await store.get<boolean>(KEY_SKIP_AUTO_CONFIRM)) ?? false;
}

export async function saveSkipAutoConfirm(skip: boolean): Promise<void> {
  await store.set(KEY_SKIP_AUTO_CONFIRM, skip);
  await store.save();
}
