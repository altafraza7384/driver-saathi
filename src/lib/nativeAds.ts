import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAdsPlugin {
  showNativeAd(options: { adUnitId: string }): Promise<void>;
  setAdRect(options: { x: number; y: number; width: number; height: number }): Promise<void>;
  hideNativeAd(): Promise<void>;
}

const NativeAds = registerPlugin<NativeAdsPlugin>("NativeAds");

// Real 'Driver Saathi Native Video' AdMob native unit.
export const NATIVE_AD_UNIT_ID = "ca-app-pub-1994214977986364/8263891910";

export function isNativeAdsAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NativeAds");
}

export async function showNativeAd(): Promise<void> {
  try {
    await NativeAds.showNativeAd({ adUnitId: NATIVE_AD_UNIT_ID });
  } catch {
    // Ad failed to show; nothing to clean up.
  }
}

export async function setNativeAdRect(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
  try {
    await NativeAds.setAdRect(rect);
  } catch {
    // Ad rect update failed; nothing to clean up.
  }
}

export async function hideNativeAd(): Promise<void> {
  try {
    await NativeAds.hideNativeAd();
  } catch {
    // Already gone; nothing to clean up.
  }
}
