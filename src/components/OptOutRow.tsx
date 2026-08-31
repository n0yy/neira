import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useId } from "react";

/** Checkbox + label row for a dialog's "don't ask again" opt-out. */
export function OptOutRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="-mt-3 flex items-center justify-center gap-2 sm:justify-start">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label
        htmlFor={id}
        className="font-normal text-[12px] text-muted-foreground"
      >
        {label}
      </Label>
    </div>
  );
}
