export const AI_DOCK_DEFAULT_WIDTH = 380;
export const AI_DOCK_MIN_WIDTH = 320;
export const AI_DOCK_MAX_WIDTH = 540;

const AI_DOCK_WIDTH_STORAGE_KEY = "neira.aiDock.width";
const AI_DOCK_COLLAPSED_STORAGE_KEY = "neira.aiDock.collapsed";

export function shouldPersistAiDockWidth(
  width: number,
  isUserInteraction: boolean,
): boolean {
  return isUserInteraction && width > 0;
}

export function clampAiDockWidth(width: number): number {
  return Math.min(
    AI_DOCK_MAX_WIDTH,
    Math.max(AI_DOCK_MIN_WIDTH, Math.round(width)),
  );
}

export function readAiDockWidth(): number {
  try {
    const stored = window.localStorage.getItem(AI_DOCK_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampAiDockWidth(parsed)
      : AI_DOCK_DEFAULT_WIDTH;
  } catch {
    return AI_DOCK_DEFAULT_WIDTH;
  }
}

export function readAiDockCollapsed(): boolean {
  try {
    return window.localStorage.getItem(AI_DOCK_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistAiDockCollapsedStorage(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      AI_DOCK_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // storage may fail in private mode
  }
}

export function persistAiDockWidthStorage(width: number): void {
  try {
    window.localStorage.setItem(AI_DOCK_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}
