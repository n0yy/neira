import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useState } from "react";

export type CredentialField = {
  key: string;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
};

export type IntegrationStatus =
  | "disconnected"
  | "validating"
  | "connected"
  | "invalid";

type Props = {
  icon: ReactNode;
  title: string;
  description: string;
  docsUrl?: string;
  fields: readonly CredentialField[];
  status: IntegrationStatus;
  /** e.g. "Connected as octocat" when connected, or the error message when invalid. */
  statusDetail?: string | null;
  onConnect: (values: Record<string, string>) => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** Rendered below the credential row while status === "connected". */
  children?: ReactNode;
};

export function IntegrationCredentialCard({
  icon,
  title,
  description,
  docsUrl,
  fields,
  status,
  statusDetail,
  onConnect,
  onDisconnect,
  children,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const connected = status === "connected";
  const validating = status === "validating";

  const canSubmit = fields.every((f) => (values[f.key] ?? "").trim());

  const submit = async () => {
    if (!canSubmit || validating) return;
    const trimmed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]),
    );
    await onConnect(trimmed);
  };

  const disconnect = async () => {
    await onDisconnect();
    setValues({});
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[12.5px] font-medium">{title}</span>
        {connected ? (
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
        {docsUrl ? (
          <button
            type="button"
            onClick={() => void openUrl(docsUrl)}
            className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Docs
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={11}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
        {connected ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void disconnect()}
            title="Disconnect"
            className={cn(
              "size-7 text-muted-foreground hover:text-destructive",
              !docsUrl && "ml-auto",
            )}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>

      <span className="text-[10.5px] leading-relaxed text-muted-foreground">
        {description}
      </span>

      {!connected ? (
        <div className="flex flex-col gap-2">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <span className="text-[11px] tracking-tight text-muted-foreground">
                {f.label}
              </span>
              <Input
                type={f.type ?? "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                disabled={validating}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                className="h-8 font-mono text-[11.5px]"
              />
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={!canSubmit || validating}
            className="h-8 w-fit gap-1 self-end px-3 text-[11px]"
          >
            {validating ? <Spinner className="size-3" /> : null}
            Connect
          </Button>
          {status === "invalid" && statusDetail ? (
            <p className="text-[10.5px] text-destructive">{statusDetail}</p>
          ) : null}
        </div>
      ) : (
        <>
          {statusDetail ? (
            <p className="text-[10.5px] text-muted-foreground">
              {statusDetail}
            </p>
          ) : null}
          {children}
        </>
      )}
    </div>
  );
}
