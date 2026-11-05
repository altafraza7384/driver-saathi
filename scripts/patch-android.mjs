#!/usr/bin/env node
// Applies the Android 12+ system splash fix the Capacitor-generated
// android/ project needs. android/ is not committed (it is generated
// with `cap add android`), so this edit would be lost on every fresh
// clone — this script re-applies it. Safe to run any number of times
// (idempotent). Run after `cap add android` / `cap sync android`:
// bun run cap:patch
//
// android/app/src/main/res/values/styles.xml: in the launch theme,
// set android:windowSplashScreenAnimatedIcon to
// @mipmap/ic_launcher_foreground. On Android 12+ the system splash
// shows the app's adaptive launcher icon, whose background layer
// (assets/icon-background.png) is solid white — that white layer is
// the white rounded square on the splash. The foreground layer is
// the transparent logo, so the splash shows the logo directly on
// the navy splash background. The launcher/home icon is unchanged.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
if (launchTheme.includes(splashIconItem)) {
  console.log('patch-android: styles.xml launch theme already uses @mipmap/ic_launcher_foreground for the system splash icon');
} else {
  const lineStart = styles.lastIndexOf(newline, markerIndex) + 1;
  const indent = styles.slice(lineStart, markerIndex);
  const patchedTheme = launchTheme.replace(
    splashBackgroundItem,
    splashBackgroundItem + newline + indent + splashIconItem,
  );
  styles = styles.slice(0, styleStart) + patchedTheme + styles.slice(styleEnd + styleClose.length);
  writeFileSync(stylesPath, styles);
  console.log('patch-android: styles.xml launch theme now uses @mipmap/ic_launcher_foreground for the system splash icon');
}
