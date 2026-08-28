import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { type ReactNode, useMemo, useState } from "react";

type Props<T> = {
  /** Plural label used in headings/placeholders, e.g. "Repositories" or "Jira projects". */
  title: string;
  items: T[] | null;
  truncated: boolean;
  loadError: string | null;
  selected: readonly string[];
  filter: (items: readonly T[], query: string) => T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onToggle: (key: string, checked: boolean) => void;
};

export function IntegrationItemPicker<T>({
  title,
  items,
  truncated,
  loadError,
  selected,
  filter,
  getKey,
  renderItem,
  onToggle,
}: Props<T>) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const lower = title.toLowerCase();

  const visible = useMemo(
    () => (items ? filter(items, query) : []),
    [items, query, filter],
  );

  if (loadError) {
    return (
      <p className="text-[10.5px] text-destructive/80">
        Couldn't load {lower}: {loadError}
      </p>
    );
  }

  if (!items) {
    return (
      <p className="text-[10.5px] text-muted-foreground">Loading {lower}…</p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] tracking-tight text-muted-foreground">
        {title} ({selected.length} selected)
      </span>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${lower}…`}
        spellCheck={false}
        className="h-8 text-[11.5px]"
      />
      <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/40 p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] text-muted-foreground">
            No {lower} match.
          </p>
        ) : (
          visible.map((item) => {
            const key = getKey(item);
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11.5px] hover:bg-muted/40"
              >
                <Checkbox
                  checked={selectedSet.has(key)}
                  onCheckedChange={(checked) =>
                    onToggle(key, checked === true)
                  }
                />
                {renderItem(item)}
              </label>
            );
          })
        )}
      </div>
      {truncated ? (
        <p className="text-[10.5px] text-muted-foreground/70">
          Showing the first 500 {lower}. Narrow your search to find more.
        </p>
      ) : null}
    </div>
  );
}
