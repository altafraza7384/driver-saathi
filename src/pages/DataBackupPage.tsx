import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { buildBackupPdf } from "@/lib/backupPdf";
import { localToday } from "@/lib/budgets";

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
      const doc = await buildBackupPdf(
        async (table) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await db.from(table as any).select("*");
          if (error) throw error;
          return (data ?? []) as unknown as Record<string, unknown>[];
        },
        { name: user.user_metadata?.full_name ?? null, email: user.email ?? null },
      );
      doc.save(`DriverSaathi-backup-${localToday()}.pdf`);
      toast({ title: t("backup.exportDone") });
    } catch (err: unknown) {
      toast({ title: t("auth.error"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
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