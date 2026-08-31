import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  CheckListIcon,
  PencilEdit02Icon,
  ShieldUserIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  PERMISSION_MODES,
  PERMISSION_MODE_DESCRIPTIONS,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
} from "../lib/permissionMode";
import { usePermissionModeStore } from "../store/permissionModeStore";

const ICONS: Record<PermissionMode, typeof CheckListIcon> = {
  manual: ShieldUserIcon,
  "accept-edits": PencilEdit02Icon,
  auto: SparklesIcon,
  plan: CheckListIcon,
};

export function PermissionModeSwitcher({
  isMiniWindow,
}: {
  isMiniWindow?: boolean;
}) {
  const mode = usePermissionModeStore((s) => s.mode);
  const setMode = usePermissionModeStore((s) => s.setMode);
  const ActiveIcon = ICONS[mode];
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

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
            title={`Permission mode: ${PERMISSION_MODE_LABELS[mode]}`}
          >
            <HugeiconsIcon icon={ActiveIcon} size={11} strokeWidth={1.75} />
            <span className="max-w-[6rem] truncate">
              {PERMISSION_MODE_LABELS[mode]}
            </span>
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
          className="min-w-64"
          container={anchor ?? undefined}
        >
          {PERMISSION_MODES.map((m) => {
            const Icon = ICONS[m];
            return (
              <DropdownMenuItem
                key={m}
                onSelect={() => setMode(m)}
                className={cn(
                  "flex items-start gap-2 pr-2 text-[12px]",
                  m === mode && "bg-accent/40",
                )}
              >
                <HugeiconsIcon
                  icon={Icon}
                  size={13}
                  strokeWidth={1.75}
                  className={cn(
                    "mt-0.5",
                    m === mode ? "text-foreground" : "text-muted-foreground",
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{PERMISSION_MODE_LABELS[m]}</span>
                  <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                    {PERMISSION_MODE_DESCRIPTIONS[m]}
                  </span>
                </span>
                {m === mode ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={12}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
