import { isNative } from "@/lib/admob";

interface AdBannerProps {
  className?: string;
}

/**
 * AdBanner – On native platforms, renders a spacer so the native AdMob banner
 * (shown by Capacitor plugin) doesn't overlap content.
 * On web, renders nothing (AdSense removed).
 */
export function AdBanner({ className = "" }: AdBannerProps) {
  // On native, return a spacer for the native AdMob banner
  if (isNative()) {
    return <div className={`w-full ${className}`} style={{ minHeight: 50 }} />;
  }

  // On web, no ads — AdSense removed
  return null;
}
