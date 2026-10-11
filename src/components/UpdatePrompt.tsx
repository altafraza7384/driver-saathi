import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";


const CHECK_INTERVAL = 5 * 60 * 1000;
type Kind = "store" | "web" | null;

/** Shows an update banner for new Play Store versions (native) and new web releases. */
export function UpdatePrompt() {
  const [kind, setKind] = useState<Kind>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const checkStore = useCallback(async () => {
    if (Capacitor.getPlatform() !== "android") return false;
    try {
      const { AppUpdate, AppUpdateAvailability } = await import("@capawesome/capacitor-app-update");
      const info = await AppUpdate.getAppUpdateInfo();
      if (info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE) { setKind("store"); return true; }
    } catch { /* plugin missing in older builds or not installed from Play */ }
    return false;
  }, []);

  const checkWeb = useCallback(async () => {
    if (import.meta.env.DEV) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { buildId } = await res.json();
      if (buildId && buildId !== __APP_BUILD_ID__) setKind((k) => k ?? "web");
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
          <p className="font-bold leading-tight">Update available</p>
          <p className="text-sm text-muted-foreground">
            {kind === "store" ? "A new version is on Play Store." : "A new version of the app is ready."}
          </p>
        </div>
        <Button size="sm" className="h-11" onClick={update} disabled={busy}>{busy ? "..." : "Update"}</Button>
        <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label="Later" onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
