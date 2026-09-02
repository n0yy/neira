import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getBindingTokens,
  SHORTCUTS,
} from "@/modules/shortcuts/shortcuts";
import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  getCompatModelInfo,
  isCompatModelId,
  MODELS,
  resolveModel,
} from "@/modules/ai/config";
import {
  type CustomEndpointKeys,
  clearCustomEndpointKey,
  getAllCustomEndpointKeys,
  setCustomEndpointKey,
} from "@/modules/ai/lib/keyring";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type AutocompleteTrigger,
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setAutocompleteTrigger,
  setCustomEndpoints,
  setDefaultModel,
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";
import {
  emptyReasoningConfig,
  REASONING_SHAPES,
  type ReasoningConfig,
  type ReasoningShape,
} from "@/modules/ai/lib/reasoningEffort";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ChevronDown,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { SectionHeader } from "../components/SectionHeader";

export function ModelsSection() {
  const [epKeys, setEpKeys] = useState<CustomEndpointKeys>({});

  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const compatBaseURL = usePreferencesStore((s) => s.openaiCompatibleBaseURL);
  const compatModelId = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  // The single global "openai-compatible-custom" model id is a legacy config
  // predating named custom endpoints — migrateLegacyCompatEndpoint() folds it
  // into customEndpoints on first load, so it's only ever non-empty for a
  // user whose settings file predates that migration.
  const legacyCompatConfigured =
    !!compatBaseURL.trim() && !!compatModelId.trim();

  useEffect(() => {
    void getAllCustomEndpointKeys(customEndpoints).then(setEpKeys);
  }, [customEndpoints]);

  const onSaveEndpointKey = async (endpointId: string, value: string) => {
    await setCustomEndpointKey(endpointId, value);
    setEpKeys((prev) => ({ ...prev, [endpointId]: value }));
    await emitKeysChanged();
  };

  const onClearEndpointKey = async (endpointId: string) => {
    await clearCustomEndpointKey(endpointId);
    setEpKeys((prev) => ({ ...prev, [endpointId]: null }));
    await emitKeysChanged();
  };

  const addCustomEndpoint = async () => {
    const ep: CustomEndpoint = {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      baseURL: "",
      modelId: "",
      contextLimit: 128_000,
    };
    await setCustomEndpoints([...customEndpoints, ep]);
  };

  const updateCustomEndpoint = async (
    id: string,
    patch: Partial<CustomEndpoint>,
  ) => {
    await setCustomEndpoints(
      customEndpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const removeCustomEndpoint = async (id: string) => {
    await clearCustomEndpointKey(id);
    setEpKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    // Drop the now-dead model id from favorites/recents before touching the
    // selection, so the recents push from a selection reset can't race it.
    const deadModelId = compatModelIdForEndpoint(id);
    const { favoriteModelIds, recentModelIds } = usePreferencesStore.getState();
    if (favoriteModelIds.includes(deadModelId)) {
      await setFavoriteModelIds(
        favoriteModelIds.filter((m) => m !== deadModelId),
      );
    }
    if (recentModelIds.includes(deadModelId)) {
      await setRecentModelIds(recentModelIds.filter((m) => m !== deadModelId));
    }

    // If the deleted endpoint was the active model, the selection would dangle
    // and the next send throws "Custom endpoint not found". Fall back to another
    // endpoint when one remains, else the default model.
    const remaining = customEndpoints.filter((e) => e.id !== id);
    const fallbackModelId = remaining[0]
      ? compatModelIdForEndpoint(remaining[0].id)
      : DEFAULT_MODEL_ID;
    const { selectedModelId, setSelectedModelId } = useChatStore.getState();
    if (selectedModelId === deadModelId) {
      setSelectedModelId(fallbackModelId);
    }

    // Same dangling-reference risk for the persisted "default chat model"
    // preference (settings/store.ts's defaultModelId can hold a compat id
    // since this endpoint could have been set as the default) — otherwise
    // the next app launch re-hydrates selectedModelId from a dead id.
    const { defaultModelId } = usePreferencesStore.getState();
    if (defaultModelId === deadModelId) {
      await setDefaultModel(fallbackModelId);
    }

    await setCustomEndpoints(remaining);
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Connect the OpenAI-compatible endpoints you use. Keys live in your OS keychain and are used only by Neira."
      />

      <DefaultsBlock
        defaultModel={defaultModel}
        legacyCompatConfigured={legacyCompatConfigured}
        customEndpoints={customEndpoints}
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Endpoints</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void addCustomEndpoint()}
            className="h-7 gap-1.5 px-2.5 text-[11px]"
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            Add endpoint
          </Button>
        </div>

        {customEndpoints.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              No endpoints connected yet.
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              Click "Add endpoint" to connect an OpenAI-compatible server.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {customEndpoints.map((ep) => (
              <CustomEndpointCard
                key={ep.id}
                endpoint={ep}
                endpointKey={epKeys[ep.id] ?? null}
                onSaveKey={(v) => onSaveEndpointKey(ep.id, v)}
                onClearKey={() => onClearEndpointKey(ep.id)}
                onUpdate={(patch) => updateCustomEndpoint(ep.id, patch)}
                onRemove={() => removeCustomEndpoint(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DefaultsBlock({
  defaultModel,
  legacyCompatConfigured,
  customEndpoints,
}: {
  defaultModel: string;
  legacyCompatConfigured: boolean;
  customEndpoints: readonly CustomEndpoint[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label>Defaults</Label>
      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Chat model">
          <DefaultModelPicker
            defaultModel={defaultModel}
            legacyCompatConfigured={legacyCompatConfigured}
            customEndpoints={customEndpoints}
          />
        </FieldRow>
        <AutocompleteRow customEndpoints={customEndpoints} />
      </div>
    </div>
  );
}

function DefaultModelPicker({
  defaultModel,
  legacyCompatConfigured,
  customEndpoints,
}: {
  defaultModel: string;
  legacyCompatConfigured: boolean;
  customEndpoints: readonly CustomEndpoint[];
}) {
  const m = resolveModel(defaultModel, customEndpoints);
  // One selectable model per fully-configured named endpoint, same pool
  // AutocompleteRow already builds for the same reason.
  const compatItems = useMemo(
    () =>
      customEndpoints
        .filter((e) => e.baseURL.trim() && e.modelId.trim())
        .map((e) =>
          getCompatModelInfo(compatModelIdForEndpoint(e.id), customEndpoints),
        ),
    [customEndpoints],
  );
  const hasAny = legacyCompatConfigured || compatItems.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={!hasAny}
          className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
        >
          <span className="flex items-center gap-2 truncate">
            <ProviderIcon provider={m.provider} size={13} />
            <span className="truncate">{m.label}</span>
            <span className="text-muted-foreground">· {m.hint}</span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-70 p-1"
      >
        <div className="max-h-72 overflow-y-auto overscroll-contain pr-1">
          {legacyCompatConfigured &&
            MODELS.map((mod) => (
              <DropdownMenuItem
                key={mod.id}
                onSelect={() => void setDefaultModel(mod.id)}
                className={cn(
                  "flex items-start gap-2 text-[12px]",
                  mod.id === defaultModel && "bg-accent/50",
                )}
              >
                <span className="flex flex-1 flex-col">
                  <span>{mod.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {mod.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          {compatItems.length > 0 && (
            <div className="px-1 pt-1.5 first:pt-1">
              <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <ProviderIcon provider="openai-compatible" size={11} />
                <span>Custom endpoints</span>
              </div>
              {compatItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => void setDefaultModel(item.id)}
                  className={cn(
                    "flex items-start gap-2 text-[12px]",
                    item.id === defaultModel && "bg-accent/50",
                  )}
                >
                  <span className="flex flex-1 flex-col">
                    <span>{item.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutocompleteRow({
  customEndpoints,
}: {
  customEndpoints: readonly CustomEndpoint[];
}) {
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const trigger = usePreferencesStore((s) => s.autocompleteTrigger);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const aiCompleteShortcut = useMemo(() => {
    const s = SHORTCUTS.find((x) => x.id === "editor.aiComplete");
    const bindings = userShortcuts["editor.aiComplete"] || s?.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join("");
  }, [userShortcuts]);

  // One selectable model per fully-configured named endpoint. The legacy
  // single-endpoint "openai-compatible-custom" id is deliberately excluded:
  // EditorPane's autocomplete path only knows how to resolve a compat-
  // prefixed (named endpoint) model id.
  const items = useMemo(
    () =>
      customEndpoints
        .filter((e) => e.baseURL.trim() && e.modelId.trim())
        .map((e) =>
          getCompatModelInfo(compatModelIdForEndpoint(e.id), customEndpoints),
        ),
    [customEndpoints],
  );

  const currentModel = useMemo(() => {
    if (isCompatModelId(modelId)) {
      return getCompatModelInfo(modelId, customEndpoints);
    }
    return MODELS[0];
  }, [modelId, customEndpoints]);

  const setModel = (id: string) => {
    void setAutocompleteProvider("openai-compatible");
    void setAutocompleteModelId(id);
  };

  return (
    <>
      <FieldRow label="Autocomplete">
        <div className="flex flex-1 items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void setAutocompleteEnabled(v)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={!enabled || items.length === 0}
                className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
              >
                <span className="flex items-center gap-2 truncate">
                  <ProviderIcon provider={currentModel.provider} size={12} />
                  <span className="truncate">{currentModel.label}</span>
                  <span className="text-muted-foreground">
                    · {currentModel.hint}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={11}
                  strokeWidth={2}
                  className="opacity-70"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              collisionPadding={12}
              className="max-h-72 min-w-70 overflow-y-auto"
            >
              {items.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => setModel(m.id)}
                  className={cn(
                    "text-[11.5px]",
                    m.id === modelId && "bg-accent/50",
                  )}
                >
                  <span className="flex flex-col">
                    <span>{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {m.description}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </FieldRow>
      {enabled ? (
        <FieldRow label="Trigger">
          <Select
            value={trigger}
            onValueChange={(v) =>
              void setAutocompleteTrigger(v as AutocompleteTrigger)
            }
          >
            <SelectTrigger className="h-8 w-full text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (as you type)</SelectItem>
              <SelectItem value="manual">
                Manual ({aiCompleteShortcut || "shortcut"})
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      ) : null}
      {enabled && items.length === 0 ? (
        <p className="pl-19 text-[10.5px] text-muted-foreground">
          Add an endpoint below to use autocomplete.
        </p>
      ) : null}
    </>
  );
}

function CustomEndpointCard({
  endpoint,
  endpointKey,
  onSaveKey,
  onClearKey,
  onUpdate,
  onRemove,
}: {
  endpoint: CustomEndpoint;
  endpointKey: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  onUpdate: (patch: Partial<CustomEndpoint>) => Promise<void>;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!endpoint.baseURL.trim());
  const [nameDraft, setNameDraft] = useState(endpoint.name);
  const [urlDraft, setUrlDraft] = useState(endpoint.baseURL);
  const [modelDraft, setModelDraft] = useState(endpoint.modelId);
  const [contextDraft, setContextDraft] = useState(
    String(endpoint.contextLimit ?? ""),
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setNameDraft(endpoint.name), [endpoint.name]);
  useEffect(() => setUrlDraft(endpoint.baseURL), [endpoint.baseURL]);
  useEffect(() => setModelDraft(endpoint.modelId), [endpoint.modelId]);
  useEffect(
    () => setContextDraft(String(endpoint.contextLimit ?? "")),
    [endpoint.contextLimit],
  );

  const configured = !!endpoint.baseURL.trim() && !!endpoint.modelId.trim();

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: urlDraft });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col rounded-lg border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        <HugeiconsIcon
          icon={ChevronDown}
          size={12}
          strokeWidth={2}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <ProviderIcon provider="openai-compatible" size={15} />
        <span className="text-[12.5px] font-medium truncate">
          {endpoint.name || "OpenAI Compatible"}
        </span>
        {endpoint.modelId.trim() && (
          <span className="text-[10.5px] text-muted-foreground truncate font-mono">
            {endpoint.modelId}
          </span>
        )}
        {configured ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Connected
          </Badge>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove endpoint"
          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          <FieldRow label="Name">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const v = nameDraft.trim();
                if (v !== endpoint.name) void onUpdate({ name: v });
              }}
              placeholder="My endpoint"
              spellCheck={false}
              className="h-8 flex-1 text-[11.5px]"
            />
          </FieldRow>

          <FieldRow label="Base URL">
            <div className="flex flex-1 gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v !== endpoint.baseURL) void onUpdate({ baseURL: v });
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void test()}
                disabled={!urlDraft.trim()}
                className="h-8 px-3 text-[11px]"
              >
                Test
              </Button>
            </div>
          </FieldRow>

          <FieldRow label="Model ID">
            <Input
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => {
                const v = modelDraft.trim();
                if (v !== endpoint.modelId) void onUpdate({ modelId: v });
              }}
              placeholder="gpt-4o, qwen3-max, glm-4.6, …"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>

          <FieldRow label="Context">
            <div className="flex flex-1 items-center gap-1.5">
              <Input
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                onBlur={() => {
                  const v = parseInt(contextDraft);
                  if (Number.isFinite(v) && v >= 1000)
                    void onUpdate({ contextLimit: v });
                  else setContextDraft(String(endpoint.contextLimit ?? ""));
                }}
                placeholder="128000"
                spellCheck={false}
                className="h-8 w-28 font-mono text-[11.5px]"
              />
              <span className="text-[10.5px] text-muted-foreground">
                tokens
              </span>
            </div>
          </FieldRow>

          <FieldRow label="API key">
            {endpointKey ? (
              <div className="flex flex-1 items-center gap-1.5">
                <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {`${endpointKey.slice(0, 4)}${"•".repeat(8)}${endpointKey.slice(-4)}`}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void onClearKey()}
                  title="Remove key"
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            ) : (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Optional — leave empty for unauthenticated endpoints"
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    const v = keyDraft.trim();
                    if (!v) return;
                    await onSaveKey(v);
                    setKeyDraft("");
                  }}
                  disabled={!keyDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  Save
                </Button>
              </div>
            )}
          </FieldRow>

          <StatusLine status={testStatus} />

          <ReasoningEffortFields
            config={endpoint.reasoning ?? null}
            onChange={(next) => onUpdate({ reasoning: next })}
          />
        </div>
      )}
    </div>
  );
}

function ReasoningEffortFields({
  config,
  onChange,
}: {
  config: ReasoningConfig | null;
  onChange: (next: ReasoningConfig) => Promise<void>;
}) {
  const cfg = config ?? emptyReasoningConfig();
  const [levelsDraft, setLevelsDraft] = useState(cfg.levels.join(", "));

  useEffect(() => setLevelsDraft(cfg.levels.join(", ")), [cfg.levels]);

  const commitLevels = () => {
    const levels = levelsDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (levels.join(", ") === cfg.levels.join(", ")) return;
    const defaultLevel = levels.includes(cfg.defaultLevel)
      ? cfg.defaultLevel
      : (levels[0] ?? "");
    const activeLevel = levels.includes(cfg.activeLevel) ? cfg.activeLevel : "";
    void onChange({ ...cfg, levels, defaultLevel, activeLevel });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">Reasoning effort</span>
        <Switch
          checked={cfg.enabled}
          onCheckedChange={(checked) => void onChange({ ...cfg, enabled: checked })}
        />
      </div>

      {cfg.enabled ? (
        <>
          <FieldRow label="Shape">
            <Select
              value={cfg.shape}
              onValueChange={(v) =>
                void onChange({ ...cfg, shape: v as ReasoningShape })
              }
            >
              <SelectTrigger className="h-8 flex-1 text-[11.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING_SHAPES.map((s) => (
                  <SelectItem
                    key={s.value}
                    value={s.value}
                    className="text-[11.5px]"
                  >
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {(() => {
            const hint = REASONING_SHAPES.find((s) => s.value === cfg.shape)?.hint;
            return hint ? (
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {hint}
              </p>
            ) : null;
          })()}

          <FieldRow label="Levels">
            <Input
              value={levelsDraft}
              onChange={(e) => setLevelsDraft(e.target.value)}
              onBlur={commitLevels}
              placeholder="low, medium, xhigh"
              spellCheck={false}
              className="h-8 flex-1 font-mono text-[11.5px]"
            />
          </FieldRow>

          {cfg.levels.length > 0 ? (
            <FieldRow label="Default">
              <Select
                value={cfg.levels.includes(cfg.defaultLevel) ? cfg.defaultLevel : cfg.levels[0]}
                onValueChange={(v) => void onChange({ ...cfg, defaultLevel: v })}
              >
                <SelectTrigger className="h-8 flex-1 text-[11.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cfg.levels.map((l) => (
                    <SelectItem key={l} value={l} className="text-[11.5px]">
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          ) : (
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Enter the exact level names this backend accepts, comma-separated.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}

function StatusLine({
  status,
}: {
  status: "idle" | "testing" | "ok" | "fail";
}) {
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <span className="text-[10.5px] text-muted-foreground">Testing…</span>
    );
  }
  if (status === "ok") {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        Reachable — server responded.
      </span>
    );
  }
  return (
    <span className="text-[10.5px] text-destructive/80">
      Could not reach the server.
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
