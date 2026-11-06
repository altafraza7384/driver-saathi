import { Capacitor } from '@capacitor/core';
import { AdMob } from '@capacitor-community/admob';

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

let initPromise: Promise<boolean> | null = null;

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
