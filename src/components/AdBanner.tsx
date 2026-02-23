import { useEffect, useRef } from "react";
import { isNative } from "@/lib/admob";

interface AdBannerProps {
  adSlot?: string;
  adFormat?: string;
  fullWidthResponsive?: boolean;
  className?: string;
}

export function AdBanner({
  adSlot = "1006670616",
  adFormat = "horizontal",
  fullWidthResponsive = true,
  className = "",
}: AdBannerProps) {
  const adRef = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    // On native, AdMob banner is shown natively (not in webview)
    if (isNative() || pushed.current) return;
    try {
      const adsbygoogle = (window as Window & { adsbygoogle: unknown[] }).adsbygoogle || [];
      adsbygoogle.push({});
      pushed.current = true;
    } catch (e) {
      // AdSense not loaded
    }
  }, []);

  // On native, return an empty spacer so native banner doesn't overlap content
  if (isNative()) {
    return <div className={`w-full ${className}`} style={{ minHeight: 50 }} />;
  }

  return (
    <div
      ref={adRef}
      className={`w-full overflow-hidden ${className}`}
      style={{ minHeight: 50, maxHeight: 90 }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%", height: "auto", maxHeight: 90 }}
        data-ad-client="ca-pub-1994214977986364"
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive ? "true" : "false"}
      />
    </div>
  );
}
