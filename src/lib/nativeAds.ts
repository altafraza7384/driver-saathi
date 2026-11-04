import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAdsPlugin {
  showNativeAd(options: { adUnitId: string }): Promise<void>;
  setAdRect(options: { x: number; y: number; width: number; height: number }): Promise<void>;
  hideNativeAd(): Promise<void>;
}

const NativeAds = registerPlugin<NativeAdsPlugin>("NativeAds");

// Google test native ad unit. Replace with the real AdMob native unit id
// (created in the AdMob console) before the Play release build; until then
// the slot shows test ads, which is the safe state for development.
export const NATIVE_AD_UNIT_ID = "ca-app-pub-3940256099942544/2247696110";

export function isNativeAdsAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NativeAds");
}

export async function showNativeAd(): Promise<void> {
  await NativeAds.showNativeAd({ adUnitId: NATIVE_AD_UNIT_ID });
}

export async function setNativeAdRect(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
  await NativeAds.setAdRect(rect);
}

export async function hideNativeAd(): Promise<void> {
  try {
    await NativeAds.hideNativeAd();
  } catch {
    // Already gone; nothing to clean up.
  }
}
