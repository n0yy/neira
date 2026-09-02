import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setCustomEndpoints } from "@/modules/settings/store";
import {
  ArrowDown01Icon,
  IdeaIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  endpointIdFromCompatModel,
  isCompatModelId,
  resolveModel,
  type CustomEndpoint,
} from "../config";
import {
  isReasoningConfigUsable,
  resolveActiveReasoningLevel,
  type ReasoningConfig,
} from "../lib/reasoningEffort";
import {
  setLmstudioReasoning,
  setMlxReasoning,
  setOllamaReasoning,
  setOpenrouterReasoning,
} from "@/modules/settings/store";
import { useChatStore } from "../store/chatStore";

type Target =
  | { kind: "endpoint"; endpointId: string; cfg: ReasoningConfig }
  | { kind: "lmstudio" | "mlx" | "ollama" | "openrouter"; cfg: ReasoningConfig };

type ReasoningPrefsSlice = {
  customEndpoints: readonly CustomEndpoint[];
  lmstudioReasoning: ReasoningConfig | null;
  mlxReasoning: ReasoningConfig | null;
  ollamaReasoning: ReasoningConfig | null;
  openrouterReasoning: ReasoningConfig | null;
};

/** Resolves the reasoning config (if any) that applies to the given model id, and how to persist a new active level for it. Pure: takes the relevant preference values directly rather than reading the store, so a caller with a reactive subscription (the component below) is guaranteed a fresh result on every render. */
export function resolveTargetFrom(
  modelId: string,
  prefs: ReasoningPrefsSlice,
): Target | null {
  if (isCompatModelId(modelId)) {
    const eid = endpointIdFromCompatModel(modelId);
    const ep = prefs.customEndpoints.find((e) => e.id === eid);
    if (!ep || !isReasoningConfigUsable(ep.reasoning)) return null;
    return { kind: "endpoint", endpointId: eid, cfg: ep.reasoning };
  }

  const m = resolveModel(modelId, prefs.customEndpoints);
  switch (m.id) {
    case "lmstudio-local":
      return isReasoningConfigUsable(prefs.lmstudioReasoning)
        ? { kind: "lmstudio", cfg: prefs.lmstudioReasoning }
        : null;
    case "mlx-local":
      return isReasoningConfigUsable(prefs.mlxReasoning)
        ? { kind: "mlx", cfg: prefs.mlxReasoning }
        : null;
    case "ollama-local":
      return isReasoningConfigUsable(prefs.ollamaReasoning)
        ? { kind: "ollama", cfg: prefs.ollamaReasoning }
        : null;
    case "openrouter-custom":
      return isReasoningConfigUsable(prefs.openrouterReasoning)
        ? { kind: "openrouter", cfg: prefs.openrouterReasoning }
        : null;
    default:
      return null;
  }
}

/** Convenience wrapper for callers outside a React render (tests, imperative call sites) that don't already have a reactive subscription to the relevant fields. */
export function resolveTarget(modelId: string): Target | null {
  const prefs = usePreferencesStore.getState();
  return resolveTargetFrom(modelId, prefs);
}

export async function persistActiveLevel(
  target: Target,
  level: string,
): Promise<void> {
  const next: ReasoningConfig = { ...target.cfg, activeLevel: level };
  switch (target.kind) {
    case "endpoint": {
      const endpoints = usePreferencesStore.getState().customEndpoints.map(
        (e) => (e.id === target.endpointId ? { ...e, reasoning: next } : e),
      );
      // Optimistic local update: AgentSwitcher/PermissionModeSwitcher's
      // stores set() synchronously before persisting; without this, the
      // trigger only updates once the async Tauri store round-trip
      // (writePref -> onPreferencesChange) completes, which reads as the
      // pick "not sticking" if that round-trip is slow or reordered.
      usePreferencesStore.setState({ customEndpoints: endpoints });
      await setCustomEndpoints(endpoints);
      return;
    }
    case "lmstudio":
      usePreferencesStore.setState({ lmstudioReasoning: next });
      await setLmstudioReasoning(next);
      return;
    case "mlx":
      usePreferencesStore.setState({ mlxReasoning: next });
      await setMlxReasoning(next);
      return;
    case "ollama":
      usePreferencesStore.setState({ ollamaReasoning: next });
      await setOllamaReasoning(next);
      return;
    case "openrouter":
      usePreferencesStore.setState({ openrouterReasoning: next });
      await setOpenrouterReasoning(next);
      return;
  }
}

export function ReasoningEffortSwitcher({
  isMiniWindow,
}: {
  isMiniWindow?: boolean;
}) {
  const modelId = useChatStore((s) => s.selectedModelId);
  // Direct reactive subscriptions (not a getState() snapshot) so a write
  // from persistActiveLevel is guaranteed to re-render this trigger with
  // the new value, the same pattern AgentSwitcher/PermissionModeSwitcher use.
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const lmstudioReasoning = usePreferencesStore((s) => s.lmstudioReasoning);
  const mlxReasoning = usePreferencesStore((s) => s.mlxReasoning);
  const ollamaReasoning = usePreferencesStore((s) => s.ollamaReasoning);
  const openrouterReasoning = usePreferencesStore(
    (s) => s.openrouterReasoning,
  );
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  const target = resolveTargetFrom(modelId, {
    customEndpoints,
    lmstudioReasoning,
    mlxReasoning,
    ollamaReasoning,
    openrouterReasoning,
  });
  if (!target) return null;

  const active = resolveActiveReasoningLevel(target.cfg);

  return (
    <div ref={setAnchor} className="contents">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="outline"
            className={cn(
              !isMiniWindow
                ? "flex h-6 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
                : "text-xs mr-1",
            )}
            title={`Reasoning effort: ${active}`}
          >
            <HugeiconsIcon icon={IdeaIcon} size={11} strokeWidth={1.75} />
            <span className="max-w-[6rem] truncate">{active}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={10}
              strokeWidth={2}
              className="opacity-70"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-40"
          container={anchor ?? undefined}
        >
          {target.cfg.levels.map((level) => (
            <DropdownMenuItem
              key={level}
              onSelect={() => void persistActiveLevel(target, level)}
              className={cn(
                "flex items-center justify-between gap-2 text-[12px]",
                level === active && "bg-accent/40",
              )}
            >
              <span>{level}</span>
              {level === active ? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={12}
                  strokeWidth={2}
                  className="text-foreground"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
