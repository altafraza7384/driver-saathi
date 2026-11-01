/**
 * On-screen diagnostic log for TEST builds only. Build with
 * VITE_ADMOB_DEBUG=1 to get a small black box at the top of the screen
 * that shows AdMob steps (init, request, loaded / failed + Google's error
 * code) and any uncaught JS error, so a tester can screenshot it without
 * adb. Off by default: production builds never show it.
 */
export const DEBUG_BUILD = import.meta.env.VITE_ADMOB_DEBUG === '1';

const lines: string[] = [];

function render(): void {
  const el = document.getElementById('ds-debug');
  if (!el) return;
  const collapsed = el.dataset.collapsed === '1';
  el.textContent = collapsed
    ? `${lines[lines.length - 1] ?? ''} (tap)`
    : `Debug log (tap to hide)\n${lines.join('\n')}`;
}

export function debugLog(message: string, isError = false): void {
  if (!DEBUG_BUILD || typeof document === 'undefined' || !document.body) return;
  const t = new Date();
  const stamp = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  lines.push(`${stamp} ${isError ? '❌ ' : ''}${message}`);
  while (lines.length > 8) lines.shift();

  let box = document.getElementById('ds-debug');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ds-debug';
    box.setAttribute(
      'style',
      [
        'position:fixed',
        'top:calc(env(safe-area-inset-top, 0px) + 4px)',
        'left:4px',
        'right:4px',
        'z-index:2147483647',
        'background:rgba(0,0,0,0.82)',
        'color:#7CFC00',
        'font:11px/1.35 monospace',
        'padding:6px 8px',
        'border-radius:6px',
        'white-space:pre-wrap',
        'word-break:break-word',
        'max-height:40vh',
        'overflow:hidden',
      ].join(';'),
    );
    // Tap to collapse/expand so it never blocks the app while testing.
    box.addEventListener('click', () => {
      const el = document.getElementById('ds-debug');
      if (!el) return;
      el.dataset.collapsed = el.dataset.collapsed === '1' ? '0' : '1';
      render();
    });
    document.body.appendChild(box);
  }
  render();
}

/** Test builds: also surface uncaught errors / promise rejections on screen. */
export function installDebugErrorCapture(): void {
  if (!DEBUG_BUILD || typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    debugLog(`JS error: ${e.message}`, true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined;
    debugLog(`Unhandled: ${r?.message ?? String(e.reason)}`, true);
  });
}
