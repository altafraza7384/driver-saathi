import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BACKUP_TABLES = [
  { key: "transactions", label: "Transactions" }, { key: "debts", label: "Debts" }, { key: "debt_payments", label: "Debt Payments" },
  { key: "goals", label: "Goals" }, { key: "health_logs", label: "Health Logs" }, { key: "car_checks", label: "Car Checks" },
  { key: "reminders", label: "Reminders" }, { key: "notes", label: "Notes" }, { key: "emergency_contacts", label: "Emergency Contacts" },
  { key: "platform_affiliations", label: "Platform Affiliations" }, { key: "profiles", label: "Profile" },
] as const;

export default function DataBackupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const doc = new jsPDF();
      let currentY = 20;
      doc.setFontSize(18); doc.text("Driver Buddy - Data Export", 14, currentY); currentY += 8;
      doc.setFontSize(10); doc.text(`Exported on: ${new Date().toLocaleString()}`, 14, currentY); currentY += 12;
      for (const table of BACKUP_TABLES) {
        const { data, error } = await supabase.from(table.key).select("*");
        if (error) throw error;
        if (!data || data.length === 0) continue;
        if (currentY > 250) { doc.addPage(); currentY = 20; }
        doc.setFontSize(14); doc.text(table.label, 14, currentY); currentY += 4;
        const columns = Object.keys(data[0]).filter((k) => k !== "user_id");
        const rows = data.map((row: any) => columns.map((col) => { const val = row[col]; if (val === null || val === undefined) return ""; if (typeof val === "object") return JSON.stringify(val); return String(val); }));
        autoTable(doc, { startY: currentY, head: [columns], body: rows, styles: { fontSize: 7, cellPadding: 1.5 }, headStyles: { fillColor: [59, 130, 246] }, margin: { left: 14, right: 14 }, tableWidth: "auto", didDrawPage: () => {} });
        currentY = (doc as any).lastAutoTable.finalY + 12;
      }
      doc.save(`driver-buddy-export-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: "✅", description: t("backup.exportDesc") });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-6 p-4 pt-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/more")} className="rounded-lg p-1 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-2xl font-bold">{t("backup.title")}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t("backup.desc")}</p>
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10"><Download className="h-5 w-5 text-primary" /></div>
          <div><h2 className="font-semibold">{t("backup.exportAll")}</h2><p className="text-xs text-muted-foreground">{t("backup.exportDesc")}</p></div>
        </div>
        <Button onClick={exportData} disabled={exporting} className="w-full">
          {exporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("backup.generating")}</> : t("backup.exportPdf")}
        </Button>
      </div>
      <div className="rounded-lg bg-muted/50 p-4 space-y-2">
        <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" /><p className="text-xs text-muted-foreground leading-relaxed">{t("backup.info")}</p></div>
      </div>
    </div>
  );
}