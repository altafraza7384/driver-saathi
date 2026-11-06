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
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err: AdMobError) => {
      clearWatchdog();
      // Common codes: 0 internal, 1 invalid request, 2 network, 3 no fill
      // (normal for a new / not-yet-reviewed app), 8 app id missing.
      adLog(`banner failed: code ${err?.code} ${err?.message ?? ''}`, true);
      document.documentElement.style.setProperty('--admob-banner-height', '0px');
      document.documentElement.style.setProperty('--admob-nav-lift', '0px');
      bannerRequested = false; // plugin destroys the view; allow a retry later
    }),
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
      const height = size?.height ?? 0;
      document.documentElement.style.setProperty('--admob-banner-height', `${height}px`);
      document.documentElement.style.setProperty('--admob-nav-lift', `${navLiftForBanner(height)}px`);
      if (height) adLog(`banner size ${size.width}x${size.height}`);
    }),
    AdMob.addListener(BannerAdPluginEvents.AdImpression, () => {
      adLog('impression counted');
    }),
  ];
  listenersPromise = Promise.all(handles).then(() => undefined).catch((e) => {
    adLog(`listener setup failed: ${errText(e)}`, true);
  });
  return listenersPromise;
}

/** Show the bottom banner. Never throws; every failure is logged. */
export async function showBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (bannerRequested) return;
  try {
    const ok = await initAdMob();
    if (!ok) return;
    // Listeners must exist BEFORE the request, or a fast Loaded/FailedToLoad
    // event is missed.
    await addBannerListeners();
    const options: BannerAdOptions = {
      adId: ADMOB_BANNER_ID,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: BANNER_MARGIN, // bottom edge of the banner; the nav lift (navLiftForBanner) clears the rest
      isTesting: false,
    };
    bannerRequested = true;
    adLog('requesting banner…');
    await AdMob.showBanner(options);
    adLog('request sent, waiting for Google…');
    clearWatchdog();
    watchdog = setTimeout(() => {
      adLog('no answer from Google after 30 s', true);
    }, 30000);
  } catch (e) {
    document.documentElement.style.setProperty('--admob-banner-height', '0px');
    document.documentElement.style.setProperty('--admob-nav-lift', '0px');
    bannerRequested = false;
    adLog(`showBanner failed: ${errText(e)}`, true);
  }
}

export async function hideBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.hideBanner();
  } catch (e) {
    // ignore
  }
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
