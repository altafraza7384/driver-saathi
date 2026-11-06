import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdSize,
  BannerAdPosition,
  BannerAdPluginEvents,
  type AdMobBannerSize,
  type AdMobError,
} from '@capacitor-community/admob';

const ADMOB_BANNER_ID = 'ca-app-pub-1994214977986364/7524617781';

function adLog(message: string, isError = false): void {
  if (isError) console.warn(`[AdMob] ${message}`);
  else console.log(`[AdMob] ${message}`);
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message || String(e);
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown; errorMessage?: unknown };
    const msg = o.message ?? o.errorMessage;
    if (o.code !== undefined || msg !== undefined) return `code ${String(o.code ?? '?')} ${String(msg ?? '')}`.trim();
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

const BANNER_MARGIN = 70;
function measureSafeBottom(): number {
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    const v = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    return Math.max(v, 16);
  } catch {
    return 16;
  }
}
function navLiftForBanner(bannerHeight: number): number {
  if (!bannerHeight) return 0;
  return Math.max(0, bannerHeight + BANNER_MARGIN - measureSafeBottom());
}

let initPromise: Promise<boolean> | null = null;
let listenersPromise: Promise<void> | null = null;
let bannerRequested = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog() {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
}

/** Initialise the Mobile Ads SDK once. Resolves true on success. */
export function initAdMob(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!Capacitor.isPluginAvailable('AdMob')) {
      adLog('native AdMob plugin NOT available in this build', true);
      return false;
    }
    adLog(`init… (${Capacitor.getPlatform()})`);
    try {
      await AdMob.initialize({ initializeForTesting: false });
      adLog('init ok');
      return true;
    } catch (e) {
      adLog(`init failed: ${errText(e)}`, true);
      initPromise = null; // allow a retry next time
      return false;
    }
  })();
  return initPromise;
}

function addBannerListeners(): Promise<void> {
  if (listenersPromise) return listenersPromise;
  const handles: Promise<PluginListenerHandle>[] = [
    AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      clearWatchdog();
      adLog('banner loaded ✅');
    }),
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (e: AdMobError) => {
      adLog(`banner load failed: ${errText(e)}`, true);
      document.documentElement.style.setProperty('--admob-banner-height', '0px');
      document.documentElement.style.setProperty('--admob-nav-lift', '0px');
      bannerRequested = false;
    }),
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
      const height = size?.height ?? 0;
      document.documentElement.style.setProperty('--admob-banner-height', `${height}px`);
      document.documentElement.style.setProperty('--admob-nav-lift', `${navLiftForBanner(height)}px`);
      if (height) adLog(`banner size ${size.width}x${size.height}`);
    }),
  ];
  listenersPromise = (async () => {
    await Promise.all(handles);
    adLog('banner listeners ready');
  })();
  return listenersPromise;
}

/** Hide the banner, if any. Safe to call when nothing is showing. */
export async function hideBannerAd(): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) return;
    if (!bannerRequested) return;
    bannerRequested = false;
    document.documentElement.style.setProperty('--admob-banner-height', '0px');
    await AdMob.hideBanner();
    adLog('banner hidden');
  } catch (e) {
    adLog(`hideBanner failed: ${errText(e)}`, true);
  }
}

/**
 * Show (or re-show) the adaptive banner pinned to the bottom of the screen.
 * Positioned above the bottom nav via margin and the banner-height CSS var.
 */
export async function showBannerAd(): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) return;
    if (bannerRequested) return;
    bannerRequested = true;
    const ok = await initAdMob();
    if (!ok) {
      bannerRequested = false;
      return;
    }
    await addBannerListeners();
    const options: BannerAdOptions = {
      adId: ADMOB_BANNER_ID,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: BANNER_MARGIN, // bottom edge of the banner; the nav lift (navLiftForBanner) clears the rest
      isTesting: false,
    };
    clearWatchdog();
    watchdog = setTimeout(() => {
      adLog('banner watchdog: no Loaded event in 8s — will not retry this session', true);
    }, 8000);
    await AdMob.showBanner(options);
    adLog('banner requested');
  } catch (e) {
    adLog(`showBanner failed: ${errText(e)}`, true);
    clearWatchdog();
    document.documentElement.style.setProperty('--admob-banner-height', '0px');
    document.documentElement.style.setProperty('--admob-nav-lift', '0px');
    bannerRequested = false;
  }
}
