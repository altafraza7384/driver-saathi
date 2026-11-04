import { useEffect, useRef } from "react";
import { hideNativeAd, isNativeAdsAvailable, setNativeAdRect, showNativeAd } from "@/lib/nativeAds";

/**
 * Inline AdMob native-ad slot. Renders nothing on web (native-only) and is
 * only mounted by the parent inside its messages.length === 0 block, so the
 * ad shows in the empty state, hides when chatting starts, and returns when
 * the 24h chat prune empties history again.
 */
export default function NativeAdSlot() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isNativeAdsAvailable()) return;
    const el = ref.current;
    if (!el) return;
    let stopped = false;
    const update = () => {
      if (stopped || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        void setNativeAdRect({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    };
    void showNativeAd().then(update);
    const scroller = findScroller(el);
    scroller?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const interval = window.setInterval(update, 1000);
    const stopTimer = window.setTimeout(() => window.clearInterval(interval), 5000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.clearTimeout(stopTimer);
      scroller?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      void hideNativeAd();
    };
  }, []);

  if (!isNativeAdsAvailable()) return null;
  return <div ref={ref} className="w-full" style={{ height: 300 }} aria-hidden="true" />;
}

function findScroller(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    if (p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}
