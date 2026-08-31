import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  loadPermissionMode,
  savePermissionMode,
  type PermissionMode,
} from "../lib/permissionMode";

const CHANGED_EVENT = "neira://ai-permission-mode-changed";

type PermissionModeState = {
  hydrated: boolean;
  mode: PermissionMode;
  hydrate: () => Promise<void>;
  setMode: (mode: PermissionMode) => void;
  /** Called when a new conversation starts. Resets to Manual, except Plan stays sticky. */
  resetForNewSession: () => void;
};

let initialized = false;

function broadcast(): void {
  void emit(CHANGED_EVENT);
}

export const usePermissionModeStore = create<PermissionModeState>(
  (set, get) => ({
    hydrated: false,
    mode: "manual",
    hydrate: async () => {
      if (initialized) return;
      initialized = true;
      const mode = await loadPermissionMode();
      set({ mode, hydrated: true });

      void listen(CHANGED_EVENT, async () => {
        set({ mode: await loadPermissionMode() });
      });
    },
    setMode: (mode) => {
      set({ mode });
      void savePermissionMode(mode).then(broadcast);
    },
    resetForNewSession: () => {
      if (get().mode === "plan") return;
      get().setMode("manual");
    },
  }),
);
