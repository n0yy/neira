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

/** Resolves the reasoning config (if any) that applies to the given model id, and how to persist a new active level for it. */
function resolveTarget(modelId: string): Target | null {
  const prefs = usePreferencesStore.getState();

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

async function persistActiveLevel(target: Target, level: string): Promise<void> {
  const next: ReasoningConfig = { ...target.cfg, activeLevel: level };
  switch (target.kind) {
    case "endpoint": {
      const endpoints = usePreferencesStore.getState().customEndpoints;
      await setCustomEndpoints(
        endpoints.map((e) =>
          e.id === target.endpointId ? { ...e, reasoning: next } : e,
        ),
      );
      return;
    }
    case "lmstudio":
      await setLmstudioReasoning(next);
      return;
    case "mlx":
      await setMlxReasoning(next);
      return;
    case "ollama":
      await setOllamaReasoning(next);
      return;
    case "openrouter":
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
  // Subscribe so the trigger re-renders live when reasoning config changes.
  usePreferencesStore((s) => s.customEndpoints);
  usePreferencesStore((s) => s.lmstudioReasoning);
  usePreferencesStore((s) => s.mlxReasoning);
  usePreferencesStore((s) => s.ollamaReasoning);
  usePreferencesStore((s) => s.openrouterReasoning);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  const target = resolveTarget(modelId);
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
