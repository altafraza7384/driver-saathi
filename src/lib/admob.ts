import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdSize,
  BannerAdPosition,
  BannerAdPluginEvents,
} from '@capacitor-community/admob';

const ADMOB_BANNER_ID = 'ca-app-pub-1994214977986364/7524617781';

let initialized = false;

export async function initAdMob(): Promise<void> {
  if (!Capacitor.isNativePlatform() || initialized) return;
  try {
    await AdMob.initialize();
    initialized = true;
  } catch (e) {
    console.warn('AdMob init failed', e);
  }
}

export async function showBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!initialized) await initAdMob();

  const options: BannerAdOptions = {
    adId: ADMOB_BANNER_ID,
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 70, // above bottom nav (68px nav + 2px border)
    isTesting: false,
  };

  AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
    console.log('AdMob banner loaded');
  });

  // Previously an AdMob failure here rejected unhandled and the banner
  // silently never appeared. Catch it, retry once after a delay (the
  // Mobile Ads SDK can be slow to initialise), then give up loudly.
  try {
    await AdMob.showBanner(options);
  } catch (e) {
    console.warn('AdMob showBanner failed, retrying once', e);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (!initialized) await initAdMob();
    try {
      await AdMob.showBanner(options);
    } catch (e2) {
      console.warn('AdMob showBanner retry failed', e2);
    }
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
