#!/usr/bin/env node
// Applies the Android 12+ system splash fix the Capacitor-generated
// android/ project needs. android/ is not committed (it is generated
// with `cap add android`), so this edit would be lost on every fresh
// clone — this script re-applies it. Safe to run any number of times
// (idempotent). Run after `cap add android` / `cap sync android`:
// bun run cap:patch
//
// android/app/src/main/res/values/styles.xml: in the launch theme,
// set android:windowSplashScreenAnimatedIcon to a fully transparent
// drawable, so the system splash shows NO logo — just the navy
// background. (User decision 2026-11-05: the cropped system-splash
// logo is worse than no logo; the web/Capacitor splash that follows
// shows the full logo properly, and the home icon is untouched.)
//
// Why not the launcher foreground? @mipmap/ic_launcher_foreground
// is edge-to-edge logo artwork (the gold ring touches the canvas
// edges). The system splash scales it large and circle-masks it, so
// the DRIVER/SAATHI text ring gets cut off and the logo turns
// blurry — that is what v16 showed on the phone. And removing the
// item entirely is NOT an option: Android then falls back to the
// launcher icon, whose solid-white background layer is the white
// rounded square the original fix removed. A transparent icon is
// the only way to get a clean, logo-free system splash.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');

function fail(msg) {
  console.error(`patch-android: ${msg}`);
  process.exit(1);
}

if (!existsSync(android)) {
  fail('android/ not found — run `bun x cap add android` first.');
}

// System splash icon for Android 12+ (launch theme in styles.xml).
const stylesPath = join(android, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
if (!existsSync(stylesPath)) fail(`${stylesPath} not found.`);
let styles = readFileSync(stylesPath, 'utf8');
const splashIconItem =
  '<item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon_empty</item>';
// The v16 patch used the launcher foreground — replace it if present.
const oldSplashIconItem =
  '<item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>';
const splashBackgroundItem = '<item name="android:background">@drawable/splash</item>';
const newline = String.fromCharCode(10);

// Find the launch theme by its marker — the <style> block containing
// android:background @drawable/splash. The theme name is not
// hardcoded, so a template rename does not silently patch the
// wrong style.
const markerIndex = styles.indexOf(splashBackgroundItem);
if (markerIndex === -1) {
  fail('could not find the launch theme (the <style> block containing android:background @drawable/splash) in android/app/src/main/res/values/styles.xml.');
}
const styleStart = styles.lastIndexOf('<style', markerIndex);
const styleEnd = styles.indexOf('</style>', markerIndex);
if (styleStart === -1 || styleEnd === -1) {
  fail('could not find the launch theme <style> block in android/app/src/main/res/values/styles.xml.');
}
const styleClose = '</style>';
const launchTheme = styles.slice(styleStart, styleEnd + styleClose.length);

// 1x1 fully transparent PNG (base64). Written at patch time so no
// new asset has to be committed; android/ is generated anyway.
const EMPTY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
const drawableDir = join(android, 'app', 'src', 'main', 'res', 'drawable');
mkdirSync(drawableDir, { recursive: true });
writeFileSync(
  join(drawableDir, 'splash_icon_empty.png'),
  Buffer.from(EMPTY_ICON_PNG_BASE64, 'base64'),
);

if (launchTheme.includes(splashIconItem)) {
  console.log('patch-android: styles.xml launch theme already uses @drawable/splash_icon_empty for the system splash icon (no logo)');
} else if (launchTheme.includes(oldSplashIconItem)) {
  const patchedTheme = launchTheme.replace(oldSplashIconItem, splashIconItem);
  styles = styles.slice(0, styleStart) + patchedTheme + styles.slice(styleEnd + styleClose.length);
  writeFileSync(stylesPath, styles);
  console.log('patch-android: styles.xml launch theme system splash icon replaced with @drawable/splash_icon_empty (no logo)');
} else {
  const lineStart = styles.lastIndexOf(newline, markerIndex) + 1;
  const indent = styles.slice(lineStart, markerIndex);
  const patchedTheme = launchTheme.replace(
    splashBackgroundItem,
    splashBackgroundItem + newline + indent + splashIconItem,
  );
  styles = styles.slice(0, styleStart) + patchedTheme + styles.slice(styleEnd + styleClose.length);
  writeFileSync(stylesPath, styles);
  console.log('patch-android: styles.xml launch theme now uses @drawable/splash_icon_empty for the system splash icon (no logo)');
}
