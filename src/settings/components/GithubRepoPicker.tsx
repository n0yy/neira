import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { GithubRepo } from "@/modules/integrations/github";
import { filterRepos } from "@/modules/integrations/github";
import { useMemo, useState } from "react";

type Props = {
  repos: GithubRepo[] | null;
  truncated: boolean;
  loadError: string | null;
  selected: readonly string[];
  onToggle: (fullName: string, checked: boolean) => void;
};

export function GithubRepoPicker({
  repos,
  truncated,
  loadError,
  selected,
  onToggle,
}: Props) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(
    () => (repos ? filterRepos(repos, query) : []),
    [repos, query],
  );

  if (loadError) {
    return (
      <p className="text-[10.5px] text-destructive/80">
        Couldn't load repositories: {loadError}
      </p>
    );
  }

  if (!repos) {
    return (
      <p className="text-[10.5px] text-muted-foreground">
        Loading repositories…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] tracking-tight text-muted-foreground">
        Repositories ({selected.length} selected)
      </span>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search repos…"
        spellCheck={false}
        className="h-8 text-[11.5px]"
      />
      <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/40 p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] text-muted-foreground">
            No repositories match.
          </p>
        ) : (
          visible.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11.5px] hover:bg-muted/40"
            >
              <Checkbox
                checked={selectedSet.has(r.fullName)}
                onCheckedChange={(checked) =>
                  onToggle(r.fullName, checked === true)
                }
              />
              <span className="truncate font-mono">{r.fullName}</span>
              {r.private ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                  private
                </span>
              ) : null}
            </label>
          ))
        )}
      </div>
      {truncated ? (
        <p className="text-[10.5px] text-muted-foreground/70">
          Showing the first 500 repositories. Narrow your search to find
          repos beyond that.
        </p>
      ) : null}
    </div>
  );
}
