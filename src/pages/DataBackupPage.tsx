import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const BACKUP_TABLES = [
  "transactions",
  "debts",
  "debt_payments",
  "goals",
  "health_logs",
  "car_checks",
  "reminders",
  "notes",
  "emergency_contacts",
  "platform_affiliations",
  "profiles",
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

export default function DataBackupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const backup: Record<string, unknown[]> = {};

      for (const table of BACKUP_TABLES) {
        const { data, error } = await supabase
          .from(table)
          .select("*");
        if (error) throw error;
        backup[table] = data ?? [];
      }

      const blob = new Blob(
        [JSON.stringify({ version: "1.0.0", exportedAt: new Date().toISOString(), data: backup }, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `driver-buddy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Export successful", description: "Your data has been downloaded." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const importData = async (file: File) => {
    if (!user) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.data) throw new Error("Invalid backup file format");

      const backupData = parsed.data as Record<string, any[]>;

      // Import order matters for foreign keys – debts before debt_payments
      const importOrder: BackupTable[] = [
        "profiles",
        "platform_affiliations",
        "transactions",
        "debts",
        "debt_payments",
        "goals",
        "health_logs",
        "car_checks",
        "reminders",
        "notes",
        "emergency_contacts",
      ];

      let totalImported = 0;

      for (const table of importOrder) {
        const rows = backupData[table];
        if (!rows || rows.length === 0) continue;

        // Override user_id to current user for security
        const sanitized = rows.map((row: any) => {
          const { id, created_at, updated_at, ...rest } = row;
          return { ...rest, user_id: user.id };
        });

        const { error } = await supabase.from(table).upsert(sanitized, { onConflict: "id", ignoreDuplicates: true });
        if (error) {
          console.warn(`Import warning for ${table}:`, error.message);
        } else {
          totalImported += sanitized.length;
        }
      }

      toast({ title: "Import complete", description: `${totalImported} records processed.` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) importData(file);
    };
    input.click();
  };

  return (
    <div className="space-y-6 p-4 pt-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/more")} className="rounded-lg p-1 hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold">Data Backup</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Export your data as a JSON file for safekeeping, or import a previously exported backup to restore your data.
      </p>

      {/* Export */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Download className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Export Data</h2>
            <p className="text-xs text-muted-foreground">Download all your data as a JSON file</p>
          </div>
        </div>
        <Button onClick={exportData} disabled={exporting} className="w-full">
          {exporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting...</> : "Export All Data"}
        </Button>
      </div>

      {/* Import */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/50">
            <Upload className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Import Data</h2>
            <p className="text-xs text-muted-foreground">Restore data from a backup JSON file</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleFileSelect} disabled={importing} className="w-full">
          {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing...</> : "Select Backup File"}
        </Button>
      </div>

      <div className="rounded-lg bg-muted/50 p-4 space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Importing data will add records to your account. Existing records with the same ID will be skipped. Your data is always tied to your account for security.
          </p>
        </div>
      </div>
    </div>
  );
}
