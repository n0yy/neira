import { Button } from "@/components/ui/button";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Delete02Icon, Add01Icon, ArrowUpIcon, StopCircleIcon } from "@hugeicons/core-free-icons";
import { lazy, Suspense, useMemo, useRef } from "react";
import { useComposer, ACCEPTED_FILES } from "../lib/composer";
import { getOrCreateChat } from "../store/chatRuntime";
import { useChatStore } from "../store/chatStore";
import { AiChatView } from "./AiChat";
import { ChipsRow } from "./ChipsRow";
import { ContextIndicator } from "./ContextIndicator";
import { TodoStrip } from "./TodoStrip";
import { AgentSwitcher } from "./AgentSwitcher";
import { ModelDropdown } from "./AiStatusBarControls";

const AiComposerInputLazy = lazy(() => import("./AiComposerInput").then((m) => ({ default: m.AiComposerInput })));

type Props = {
  onClose: () => void;
  hasComposer: boolean;
};

const EMPTY_MESSAGES: UIMessage[] = [];

export function AiDockPanel({ onClose, hasComposer }: Props) {
  const sessionId = useChatStore((s) => s.activeSessionId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <Header onClose={onClose} />
      <PlanModeStrip />
      {sessionId ? (
        <ActiveSession sessionId={sessionId} hasComposer={hasComposer} />
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <EmptySessionShell />
          </div>
          <ComposerFooter hasComposer={hasComposer} messages={EMPTY_MESSAGES} />
        </>
      )}
    </div>
  );
}

function PlanModeStrip() {
  return null;
}

// One `useChat` subscription shared by the message list and the composer's
// context indicator, rather than each subscribing independently. A second
// subscription to the same Chat instance would re-run the indicator's
// token-estimation pass on every chunk for no benefit.
function ActiveSession({
  sessionId,
  hasComposer,
}: {
  sessionId: string;
  hasComposer: boolean;
}) {
  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatBody helpers={helpers} />
      </div>
      <ComposerFooter hasComposer={hasComposer} messages={helpers.messages} />
    </>
  );
}

function ChatBody({ helpers }: { helpers: ReturnType<typeof useChat<UIMessage>> }) {
  const isBusy = helpers.status === "submitted" || helpers.status === "streaming";

  // Auto-focus handling is via composer focusSignal, not here.

  if (helpers.messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
          <img src="/logo.png" alt="Neira" className="size-14 opacity-90" />
          <div className="space-y-1.5">
            <p className="text-[14px] font-semibold tracking-tight">Ask Neira anything</p>
            <p className="max-w-[18rem] text-[11.5px] leading-relaxed text-muted-foreground">
              Neira sees the active terminal — cwd, recent commands, and output.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5">
            {[
              { label: "Explain the last error", text: "Explain the last error in the terminal." },
              { label: "Generate a command", text: "Give me a command to " },
              { label: "Summarize buffer", text: "Summarize what just happened in the terminal." },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => useChatStore.getState().focusInput(s.text)}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card/70 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">{s.label}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {/* Still show composer below via parent; this is just empty chat */}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px]">
      <AiChatView
        messages={helpers.messages}
        status={helpers.status}
        error={helpers.error}
        clearError={helpers.clearError}
        addToolApprovalResponse={helpers.addToolApprovalResponse}
        stop={helpers.stop}
      />
      {/* Inline busy indicator is handled inside AiChatView */}
      {isBusy ? null : null}
    </div>
  );
}

function EmptySessionShell() {
  return (
    <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
      Loading sessions…
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const deleteSession = useChatStore((s) => s.deleteSession);
  const activeId = useChatStore((s) => s.activeSessionId);

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-b border-border/60 px-2">
      <div className="flex min-w-0 items-center gap-1">
        <AgentSwitcher />
        <ModelDropdown />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {activeId ? (
          <Button type="button" size="icon" variant="ghost" className="size-6" title="Clear conversation" aria-label="Clear conversation" onClick={() => deleteSession(activeId)}>
            <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
          </Button>
        ) : null}
        <Button type="button" size="icon" variant="ghost" className="size-5" aria-label="Close" title="Close" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

function ComposerFooter({
  hasComposer: _hasComposer,
  messages,
}: {
  hasComposer: boolean;
  messages: UIMessage[];
}) {
  void _hasComposer;
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionId = useChatStore((s) => s.activeSessionId);

  return (
    <div className="shrink-0 border-t border-border/60 bg-card p-2.5">
      <TodoStrip sessionId={sessionId ?? ""} />
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-2 py-2">
        <ChipsRow
          files={c.files}
          onRemoveFile={c.removeFile}
          snippets={c.pickedSnippets}
          onRemoveSnippet={(id) => {
            const snip = c.pickedSnippets.find((s) => s.id === id);
            c.removeSnippet(id);
            if (!snip) return;
            const re = new RegExp(`(^|\\s)#${snip.handle}\\b ?`);
            c.setValue((v) => v.replace(re, (_m, lead: string) => lead));
          }}
          commands={c.pickedCommands}
          onRemoveCommand={(name) => c.removeCommand(name)}
        />
        <div className="relative min-w-0 flex-1">
          {/* Lazy AiComposerInput */}
          <ComposerTextarea />
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              void c.addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="ghost" size="icon" className="size-6" title="Attach file" onClick={() => fileInputRef.current?.click()} disabled={c.isBusy}>
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
          </Button>
          {sessionId ? (
            <ContextIndicator
              messages={messages}
              triggerClassName="h-6 gap-1 px-0 text-[10.5px]"
            />
          ) : null}
          <span className="flex-1" />
          {c.isBusy ? (
            <Button type="button" size="icon" variant="ghost" className="size-6" aria-label="Stop" onClick={c.stop}>
              <HugeiconsIcon icon={StopCircleIcon} size={13} strokeWidth={1.75} />
            </Button>
          ) : (
            <Button type="button" size="icon" onClick={c.submit} disabled={!c.canSend} className="h-6 w-8" aria-label="Send" title="Send (Enter)">
              <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerTextarea() {
  return (
    <Suspense fallback={<div className="h-10 rounded bg-muted/30" />}>
      <AiComposerInputLazy />
    </Suspense>
  );
}
