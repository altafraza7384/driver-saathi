import { useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { addMonths, format, isValid, parseISO } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function parseDateValue(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value ? date : undefined;
}

// A separate modal layer avoids clipped popovers and native WebView input pickers.
function PickerContent({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-foreground/60" />
      <DialogPrimitive.Content className="pointer-events-auto fixed left-1/2 top-1/2 z-[70] max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-lg border bg-background p-3 text-foreground shadow-lg">
        <DialogHeader className="mb-3 pr-11 text-left">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="sr-only">{label}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogPrimitive.Close asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Close picker" className="absolute right-1 top-1 h-11 w-11"><X className="h-5 w-5" /></Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

type PickerProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

const fieldClass = "h-11 w-full min-w-0 justify-between gap-1 px-2 text-[16px] font-semibold";
const menuClass = "pointer-events-auto z-[80] max-h-64";

export function DatePicker({ id, label, value, onChange, required = false }: PickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const [month, setMonth] = useState(selected ?? new Date());
  const currentYear = new Date().getFullYear();
  const startYear = Math.min(1900, month.getFullYear());
  const endYear = Math.max(currentYear + 50, month.getFullYear());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setMonth(selected ?? new Date()); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={label} aria-required={required} className={cn(fieldClass, !selected && "text-muted-foreground")}>
          <span className="truncate">{selected ? format(selected, "dd/MM/yyyy") : "dd/MM/yyyy"}</span>
          <CalendarIcon className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <PickerContent label={label}>
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

export function TimePicker({ id, label, value, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "09:00");
  const [hour, minute] = draft.split(":");
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setDraft(value || "09:00"); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={label} className={cn(fieldClass, !value && "text-muted-foreground")}>
          <span>{value || "--:--"}</span><Clock className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <PickerContent label={label}>
        <div className="grid grid-cols-2 gap-3">
          <Select value={hour} onValueChange={(v) => setDraft(`${v}:${minute}`)}>
            <SelectTrigger aria-label="Hour" className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i).padStart(2, "0")} className="min-h-11">{String(i).padStart(2, "0")}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={minute} onValueChange={(v) => setDraft(`${hour}:${v}`)}>
            <SelectTrigger aria-label="Minute" className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent className={menuClass}>{Array.from({ length: 60 }, (_, i) => <SelectItem key={i} value={String(i).padStart(2, "0")} className="min-h-11">{String(i).padStart(2, "0")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          <Button type="button" variant="ghost" className="h-11" onClick={() => { onChange(""); setOpen(false); }}>Clear</Button>
          <Button type="button" className="h-11" onClick={() => { onChange(draft); setOpen(false); }}>Done</Button>
        </div>
      </PickerContent>
    </Dialog>
  );
}