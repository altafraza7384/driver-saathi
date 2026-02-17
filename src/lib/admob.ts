import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdSize,
  BannerAdPosition,
  BannerAdPluginEvents,
} from '@capacitor-community/admob';

const ADMOB_BANNER_ID = 'ca-app-pub-1994214977986364/1134120555';

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
    margin: 60, // above bottom nav
    isTesting: false,
  };

  AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
    console.log('AdMob banner loaded');
  });

  await AdMob.showBanner(options);
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
