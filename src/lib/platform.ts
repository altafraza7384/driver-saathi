/**
 * Platform detection utilities for Despia native wrapper and other environments.
 */

/** Check if running inside a Despia native WebView */
export const isDespiaNative = (): boolean => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  // Despia injects its identifier in the user-agent or sets a global flag
  return (
    ua.includes("despia") ||
    !!(window as any).__DESPIA__ ||
    // Generic WebView detection (Android/iOS)
    (ua.includes("wv") && ua.includes("android")) ||
    (ua.includes("iphone") && !ua.includes("safari"))
  );
};

/** Check if running as installed PWA (standalone) */
export const isStandalonePWA = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
};

/** Check if running inside any native wrapper (Capacitor, Despia, or PWA) */
export const isNativeContext = (): boolean => {
  return isDespiaNative() || isStandalonePWA() || isCapacitor();
};

/** Check if running inside Capacitor */
export const isCapacitor = (): boolean => {
  if (typeof window === "undefined") return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
};

/** Get platform name for analytics/debugging */
export const getPlatformName = (): string => {
  if (isCapacitor()) return "capacitor";
  if (isDespiaNative()) return "despia";
  if (isStandalonePWA()) return "pwa";
  return "web";
};
