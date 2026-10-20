import { useId, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PickerContent } from "./date-time-picker";

export type TimePickerProps = {
  id?: string;
  /** Dialog title and trigger aria-label. Falls back to the placeholder. */
  label?: string;
  /** 24-hour "HH:mm" string, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

// Matches the standard Input's box so the trigger sits flush with sibling fields.
const fieldClass = "h-10 w-full min-w-0 justify-between gap-1 px-3 text-base font-normal md:text-sm";
const menuClass = "pointer-events-auto z-[80] max-h-64";

function parseTimeValue(value: string): { h24: number; minute: number } | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const h24 = Number(match[1]);
  const minute = Number(match[2]);
  return h24 <= 23 && minute <= 59 ? { h24, minute } : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");
const to12Hour = (h24: number) => (h24 % 12 === 0 ? 12 : h24 % 12);
const meridiemOf = (h24: number) => (h24 >= 12 ? "PM" : "AM");

function formatDisplay(value: string): string | undefined {
  const parsed = parseTimeValue(value);
  if (!parsed) return undefined;
  return `${pad(to12Hour(parsed.h24))}:${pad(parsed.minute)} ${meridiemOf(parsed.h24)}`;
}

/**
 * WebView-safe time field. Same shared modal-dialog composition as DatePicker
 * (see AGENTS.md); the trigger displays 12-hour time ("09:30 AM") while the
 * committed value stays 24-hour "HH:mm", exactly like a native time input.
 * Edits are staged in a draft and only committed on Done.
 */
export function TimePicker({
  id,
  label,
  value,
  onChange,
  placeholder = "Select time",
  disabled = false,
  required = false,
  className,
}: TimePickerProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const title = label ?? placeholder;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "09:00");
  const display = formatDisplay(value);

  const draftParsed = parseTimeValue(draft) ?? { h24: 9, minute: 0 };
  const draftH12 = to12Hour(draftParsed.h24);
  const draftMeridiem = meridiemOf(draftParsed.h24);
  const draftMinute = pad(draftParsed.minute);
  // 5-minute steps, plus the current minute so off-step stored values stay selectable.
  const minuteOptions = Array.from(new Set([...Array.from({ length: 12 }, (_, i) => i * 5), draftParsed.minute])).sort((a, b) => a - b);

  const setHour12 = (h12: string) => {
    const h24 = (Number(h12) % 12) + (draftMeridiem === "PM" ? 12 : 0);
    setDraft(`${pad(h24)}:${draftMinute}`);
  };
  const setMeridiem = (meridiem: string) => {
    const h24 = (draftH12 % 12) + (meridiem === "PM" ? 12 : 0);
    setDraft(`${pad(h24)}:${draftMinute}`);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setDraft(value || "09:00"); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button id={fieldId} type="button" variant="outline" disabled={disabled} aria-label={title} aria-required={required} className={cn(fieldClass, !display && "text-muted-foreground", className)}>
          <span className="truncate">{display ?? placeholder}</span>
          <Clock className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <PickerContent label={title}>
        <div className="grid grid-cols-[1fr_1fr_84px] gap-2">
          <Select value={String(draftH12)} onValueChange={setHour12}>
            <SelectTrigger aria-label="Hour" className="h-11 px-2 text-[16px]"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)} className="min-h-11 text-[16px]">{i + 1}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={draftMinute} onValueChange={(v) => setDraft(`${pad(draftParsed.h24)}:${v}`)}>
            <SelectTrigger aria-label="Minute" className="h-11 px-2 text-[16px]"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{minuteOptions.map((m) => <SelectItem key={m} value={pad(m)} className="min-h-11 text-[16px]">{pad(m)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={draftMeridiem} onValueChange={setMeridiem}>
            <SelectTrigger aria-label="AM or PM" className="h-11 px-2 text-[16px]"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>
              <SelectItem value="AM" className="min-h-11 text-[16px]">AM</SelectItem>
              <SelectItem value="PM" className="min-h-11 text-[16px]">PM</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          {!required ? (
            <Button type="button" variant="ghost" className="h-11" onClick={() => { onChange(""); setOpen(false); }}>Clear</Button>
          ) : <span />}
          <Button type="button" className="h-11" onClick={() => { onChange(draft); setOpen(false); }}>Done</Button>
        </div>
      </PickerContent>
    </Dialog>
  );
}
