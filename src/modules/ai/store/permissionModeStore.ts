import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  loadPermissionMode,
  loadSkipAutoConfirm,
  savePermissionMode,
  saveSkipAutoConfirm,
  type PermissionMode,
} from "../lib/permissionMode";

const CHANGED_EVENT = "neira://ai-permission-mode-changed";

type PermissionModeState = {
  hydrated: boolean;
  mode: PermissionMode;
  /** Skip the one-time confirmation dialog before entering Auto mode. */
  skipAutoConfirm: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: PermissionMode) => void;
  setSkipAutoConfirm: (skip: boolean) => void;
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
    skipAutoConfirm: false,
    hydrate: async () => {
      if (initialized) return;
      initialized = true;
      const [mode, skipAutoConfirm] = await Promise.all([
        loadPermissionMode(),
        loadSkipAutoConfirm(),
      ]);
      set({ mode, skipAutoConfirm, hydrated: true });

      void listen(CHANGED_EVENT, async () => {
        const [mode, skipAutoConfirm] = await Promise.all([
          loadPermissionMode(),
          loadSkipAutoConfirm(),
        ]);
        set({ mode, skipAutoConfirm });
      });
    },
    setMode: (mode) => {
      set({ mode });
      void savePermissionMode(mode).then(broadcast);
    },
    setSkipAutoConfirm: (skip) => {
      set({ skipAutoConfirm: skip });
      void saveSkipAutoConfirm(skip).then(broadcast);
    },
    resetForNewSession: () => {
      if (get().mode === "plan") return;
      get().setMode("manual");
    },
  }),
);
