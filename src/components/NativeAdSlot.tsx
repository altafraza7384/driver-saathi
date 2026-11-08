import { useEffect, useRef } from "react";
import { hideNativeAd, isNativeAdsAvailable, setNativeAdRect, showNativeAd } from "@/lib/nativeAds";

interface NativeAdSlotProps {
  /** Slot height in CSS pixels. Compact slots use the compact native layout. */
  height?: number;
  /**
   * When true, the native view is hidden (e.g. while an overlay such as the
   * notifications popover covers the slot). The div stays mounted so the page
   * layout does not shift; the view is re-shown when hidden turns false.
   * A native view always renders above WebView content, so without this it
   * would float over the overlay.
   */
  hidden?: boolean;
}

/**
 * Inline AdMob native-ad slot. Renders nothing on web (native-only) and is
 * The parent controls where the slot appears. The native view is positioned
 * over this slot's exact WebView rectangle, so it stays inside page content
 * instead of being attached to the bottom of the whole screen.
 *
 * The native view is positioned only when JS reports its rect, so during a
 * fast scroll the view lags behind the page and floats over the content
 * below it. To stop that, the view is moved far off-screen as soon as a
 * scroll starts and moved back to its real rect ~150ms after the scroll
 * settles — it is never in the wrong place, and the ad is never reloaded
 * (setAdRect only re-positions the existing view).
 */
export default function NativeAdSlot({ height = 300, hidden = false }: NativeAdSlotProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isNativeAdsAvailable()) return;
    const el = ref.current;
    if (!el) return;
    // Hidden (overlay open): keep the native view off the screen.
    if (hidden) {
      void hideNativeAd();
      return;
    }
    let stopped = false;
    // True while a scroll burst is in progress (ad moved off-screen).
    let offscreen = false;
    let settleTimer = 0;
    const update = () => {
      if (stopped || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        void setNativeAdRect({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    };
    // Move the native view far above the screen (same size, so its layout
    // params stay valid). No reload: setAdRect only re-positions the view.
    const moveOffscreen = () => {
      if (stopped || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        void setNativeAdRect({ x: 0, y: -10000, width: r.width, height: r.height });
      }
    };
    const onScroll = () => {
      if (stopped) return;
      if (!offscreen) {
        offscreen = true;
        moveOffscreen();
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        offscreen = false;
        update();
      }, 150);
    };
    void showNativeAd().then(update);
    const scroller = findScroller(el);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    // The page scrolls on the window, not on a parent div: without this the
    // native view stays at its old rect and floats over the content.
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const interval = window.setInterval(() => {
      if (!offscreen) update();
    }, 1000);
    const stopTimer = window.setTimeout(() => window.clearInterval(interval), 5000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.clearTimeout(stopTimer);
      window.clearTimeout(settleTimer);
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      void hideNativeAd();
    };
  }, [hidden]);

  if (!isNativeAdsAvailable()) return null;
  return <div ref={ref} className="w-full" style={{ height }} aria-hidden="true" />;
}

function findScroller(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    if (p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}
