import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

// Screens where the back button leaves the app (with a double press)
// instead of going to a previous screen.
const ROOT_PATHS = new Set(["/", "/auth"]);
const EXIT_WINDOW_MS = 2000;

// An open dialog, sheet, drawer, menu or select (all Radix): back closes it.
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]';

/**
 * Android hardware back button (native app only):
 * - an open dialog/sheet closes first;
 * - an inner page goes back to the previous in-app screen;
 * - on Home, the first press shows a short toast and a second press
 *   within 2 s exits the app.
 * Without this listener Android closed the app on every back press.
 */
export function AndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  // The listener is registered once; read the latest values through refs.
  const pathRef = useRef(location.pathname);
  const tRef = useRef(t);
  const lastPressRef = useRef(0);
  pathRef.current = location.pathname;
  tRef.current = t;

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    let handle: PluginListenerHandle | null = null;
    let disposed = false;

    CapApp.addListener("backButton", () => {
      if (document.querySelector(OPEN_OVERLAY)) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }

      const path = pathRef.current;
      if (!ROOT_PATHS.has(path)) {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate("/", { replace: true });
        return;
      }

      const now = Date.now();
      if (now - lastPressRef.current < EXIT_WINDOW_MS) {
        void CapApp.exitApp();
        return;
      }
      lastPressRef.current = now;
      toast(tRef.current("common.pressBackAgainToExit"), { duration: EXIT_WINDOW_MS });
    })
      .then((h) => {
        if (disposed) void h.remove();
        else handle = h;
      })
      .catch((e) => console.warn("Back button listener failed:", e));

    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [navigate]);

  return null;
}
