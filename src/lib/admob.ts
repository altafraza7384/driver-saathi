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
import { DEBUG_BUILD, debugLog } from './debugOverlay';

const ADMOB_BANNER_ID = 'ca-app-pub-1994214977986364/7524617781';

function adLog(message: string, isError = false): void {
  if (isError) console.warn(`[AdMob] ${message}`);
  else console.log(`[AdMob] ${message}`);
  debugLog(`AdMob: ${message}`, isError);
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
      bannerRequested = false; // plugin destroys the view; allow a retry later
    }),
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
      document.documentElement.style.setProperty('--admob-banner-height', `${size?.height ?? 0}px`);
      if (size?.height) adLog(`banner size ${size.width}x${size.height}`);
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
      margin: 70, // above bottom nav (68px nav + 2px border)
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

/** Test builds only: lets AppLayout report that the deferred start fired. */
export function adDebug(message: string): void {
  if (DEBUG_BUILD) adLog(message);
}
