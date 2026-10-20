import { useId, useState } from "react";
import { addMonths, format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PickerContent, parseDateValue } from "./date-time-picker";

export type DatePickerProps = {
  id?: string;
  /** Dialog title and trigger aria-label. Falls back to the placeholder. */
  label?: string;
  /** Date-only string "yyyy-mm-dd", or "" when unset. */
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

/**
 * WebView-safe date field. Renders a button styled like an Input and opens the
 * shared modal calendar dialog (see AGENTS.md: nested portal layers prevent
 * native WebView picker and modal-clipping failures — the reason the house
 * pattern uses a nested Dialog instead of a Popover inside form dialogs).
 * Values stay local "yyyy-mm-dd" strings, exactly like a native date input.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
  required = false,
  className,
}: DatePickerProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const title = label ?? placeholder;
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const [month, setMonth] = useState(selected ?? new Date());
  const currentYear = new Date().getFullYear();
  const startYear = Math.min(1900, month.getFullYear());
  const endYear = Math.max(currentYear + 50, month.getFullYear());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setMonth(selected ?? new Date()); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button id={fieldId} type="button" variant="outline" disabled={disabled} aria-label={title} aria-required={required} className={cn(fieldClass, !selected && "text-muted-foreground", className)}>
          <span className="truncate">{selected ? format(selected, "dd MMM yyyy") : placeholder}</span>
          <CalendarIcon className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <PickerContent label={title}>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_90px_44px] items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-5 w-5" /></Button>
          <Select value={String(month.getMonth())} onValueChange={(v) => setMonth(new Date(month.getFullYear(), Number(v), 1))}>
            <SelectTrigger aria-label="Month" className="h-11 px-2 text-[16px]"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i} value={String(i)} className="min-h-11 text-[16px]">{format(new Date(2000, i, 1), "MMM")}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(month.getFullYear())} onValueChange={(v) => setMonth(new Date(Number(v), month.getMonth(), 1))}>
            <SelectTrigger aria-label="Year" className="h-11 px-2 text-[16px]"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{Array.from({ length: endYear - startYear + 1 }, (_, i) => <SelectItem key={i} value={String(startYear + i)} className="min-h-11 text-[16px]">{startYear + i}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-5 w-5" /></Button>
        </div>
        <Calendar mode="single" selected={selected} month={month} onMonthChange={setMonth} onSelect={(date) => { if (date) { onChange(format(date, "yyyy-MM-dd")); setOpen(false); } }} initialFocus className="pointer-events-auto w-full p-0 pt-3" classNames={{
          months: "w-full", month: "w-full space-y-2", caption: "hidden", table: "w-full border-collapse",
          head_row: "grid grid-cols-7", head_cell: "text-center text-[14px] font-semibold text-muted-foreground",
          row: "mt-1 grid grid-cols-7", cell: "relative h-11 min-w-0 p-0 text-center",
          day: "h-11 w-full rounded-md p-0 text-[16px] font-semibold hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:opacity-100",
        }} />
        <div className="mt-3 flex justify-between gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => { onChange(format(new Date(), "yyyy-MM-dd")); setOpen(false); }}>Today</Button>
          {!required && <Button type="button" variant="ghost" className="h-11" onClick={() => { onChange(""); setOpen(false); }}>Clear</Button>}
        </div>
      </PickerContent>
    </Dialog>
  );
}
