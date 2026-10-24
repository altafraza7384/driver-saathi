import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";


const CHECK_INTERVAL = 5 * 60 * 1000;
type Kind = "store" | "web" | null;

// Dismissal is persisted per version: the old session-only dismiss
// nagged the user again on every 5-minute re-check (audit 2026-10-24).
const DISMISS_KEY = "update_dismissed";

/** Shows an update banner for new Play Store versions (native) and new web releases. */
export function UpdatePrompt() {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissId, setDismissId] = useState<string | null>(null);

  const checkStore = useCallback(async () => {
    if (Capacitor.getPlatform() !== "android") return false;
    try {
      const { AppUpdate, AppUpdateAvailability } = await import("@capawesome/capacitor-app-update");
      const info = await AppUpdate.getAppUpdateInfo();
      if (info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE) {
        if (localStorage.getItem(DISMISS_KEY) === "store") return false;
        setKind("store"); setDismissId("store"); return true;
      }
    } catch { /* plugin missing in older builds or not installed from Play */ }
    return false;
  }, []);

  const checkWeb = useCallback(async () => {
    if (import.meta.env.DEV) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { buildId } = await res.json();
      if (buildId && buildId !== __APP_BUILD_ID__) {
        if (localStorage.getItem(DISMISS_KEY) === `web:${buildId}`) return;
        setKind((k) => k ?? "web"); setDismissId(`web:${buildId}`);
      }
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    const run = async () => { if (!(await checkStore())) await checkWeb(); };
    run();
    const id = setInterval(run, CHECK_INTERVAL);
    const onVis = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [checkStore, checkWeb]);

  const update = async () => {
    setBusy(true);
    try {
      if (kind === "store") {
        const { AppUpdate } = await import("@capawesome/capacitor-app-update");
        try { await AppUpdate.performImmediateUpdate(); }
        catch { await AppUpdate.openAppStore(); }
        setBusy(false);
        return;
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* still reload */ }
    window.location.reload();
  };

  if (!kind || dismissed) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] pt-safe">
      <div className="mx-auto mt-2 flex w-[calc(100%-1rem)] max-w-md items-center gap-3 rounded-lg border border-border bg-background p-3 shadow-lg">
        <RefreshCw className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">{t("update.available")}</p>
          <p className="text-sm text-muted-foreground">
            {kind === "store" ? t("update.storeReady") : t("update.webReady")}
          </p>
        </div>
        <Button size="sm" className="h-11" onClick={update} disabled={busy}>{busy ? "..." : t("update.update")}</Button>
        <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label="Later" onClick={() => { if (dismissId) localStorage.setItem(DISMISS_KEY, dismissId); setDismissed(true); }}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
