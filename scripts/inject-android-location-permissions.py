#!/usr/bin/env python3
"""Inject location permissions into the generated Android manifest.

Capacitor's Geolocation plugin does NOT add these itself, so a fresh
`npx cap add android` + `npx cap sync android` build ships WITHOUT location
permissions (verified missing in v13), and Car SOS cannot get GPS.
Run after `cap sync android`, before building:
    python3 scripts/inject-android-location-permissions.py
Idempotent: skips permissions already present. The Play workflow runs this
same script, so hand builds and CI inject identically.
"""
import sys
from pathlib import Path

MANIFEST = Path("android/app/src/main/AndroidManifest.xml")
PERMISSIONS = [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
]

def main() -> int:
    if not MANIFEST.exists():
        print(f"Manifest not found: {MANIFEST} (run after 'npx cap add android')")
        return 1
    s = MANIFEST.read_text()
    missing = [p for p in PERMISSIONS if p not in s]
    if not missing:
        print("Location permissions already present, skipped")
        return 0
    lines = "".join(
        f'    <uses-permission android:name="{p}" />\n' for p in missing
    )
    anchor = "<application"
    if anchor not in s:
        print("No <application> tag found in manifest, aborting")
        return 1
    s = s.replace(anchor, lines + "    " + anchor, 1)
    MANIFEST.write_text(s)
    print(f"Injected: {', '.join(missing)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
