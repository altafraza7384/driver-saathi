# Driver Saathi — Play Store Pipeline

How releases reach users' phones without a manual build on anyone's computer.

## The two release paths (do not confuse them)

1. **Web changes (most features):** GitHub push -> Firebase Hosting
   auto-deploy (`.github/workflows/firebase-hosting.yml`) -> live site
   on Hosting (after the server.url migration; before it, the installed
   app still loads `driver-saathi.lovable.app`) -> the installed app
   loads it on next open through `server.url`. No AAB, no Play upload,
   no user update needed. This pipeline does NOT replace that path.
   NOTE (2026-10-24): Lovable publish is no longer the web path — the
   site moved to Firebase Hosting so the free Lovable badge disappears.
2. **Native / Play distribution (this pipeline):** GitHub Actions builds a
   signed AAB from `main` and uploads it to Google Play. Play's auto-update
   then delivers it to users who enabled auto-update; everyone else sees an
   Update button in Play (and the in-app UpdatePrompt banner).

## What runs automatically

Workflow: `.github/workflows/android-play-release.yml`

- Trigger: every push to `main` touching NATIVE-relevant files only
  (`package.json`, `package-lock.json`, `capacitor.config.ts`, or the
  workflow itself), plus manual dispatch from the Actions tab.
  Web-only pushes (`src/`, `public/`) deliberately do NOT trigger this
  workflow — they go through the Firebase Hosting workflow instead, so
  a new feature does not churn versionCodes or push a pointless build
  to Play Internal.
- Steps: Node 22 + JDK 17 + Android SDK -> `bun install` (bun.lock is the source of truth; `npm ci` fails on the stale package-lock.json) -> `bun run build` ->
  `npx cap add android` + `npx cap sync android` (android/ is generated in
  the runner, never committed) -> versionCode = GitHub run number,
  versionName = `1.0.<run number>` (Play rejects a repeated versionCode, so
  this guarantees every upload is newer) -> AdMob App ID injected into the
  manifest if absent -> google-services.json from secret (if set) ->
  keystore + key.properties from secrets -> `./gradlew bundleRelease` ->
  AAB uploaded as an Actions artifact AND, when the Play secret exists,
  uploaded to Play (default track: `internal`; manual dispatch can choose
  `production`).
- Native launcher icon: after generating `android/` and syncing, run `npx -y @capacitor/assets generate --android --icon-only` so the launcher icon comes from `assets/icon.png` (1024px logo source in the repo).
- - If the keystore secrets are missing, the job fails with a clear error
  instead of making an unsigned bundle Play would reject.
- If only the Play secret is missing, the signed AAB is kept as an artifact
  and the Play step is skipped, so a manual Play Console upload from that
    exact file stays possible.

## What ONLY the owner can do (the assistant cannot do these)

These need the owner's Google account, Play Console, and his own computer.
Never send a keystore, a password, or a service-account JSON in chat, in a
file, or to the assistant. Secrets go straight into GitHub, by the owner.

### Step 1 — Play Console app (one time, cannot be automated)

1. Open [Play Console](https://play.google.com/console) with the Google
   account that will own the app. Pay the one-time $25 developer fee if
   not already paid.
2. Create app: name "Driver Saathi", package `com.driversaathi.app`,
   default language, app or game = App, free.
3. Complete the required setup before the first release can go out:
   store listing (description, screenshots, icon, feature graphic),
   content rating questionnaire, privacy policy URL, app access, ads
   declaration (the app shows AdMob ads), data safety form.
4. Create an Internal testing track and add yourself as a tester. The
   first automated upload goes here — promote to Production in Play
   Console only after testing that build on a real phone.

### Step 2 — Upload keystore (one time, on the owner's computer only)

```bash
keytool -genkeypair -v -keystore upload-keystore.jks -alias driver-saathi-upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload-keystore.jks > upload-keystore.base64.txt
```

Keep `upload-keystore.jks` and its passwords safe (password manager).
Losing the upload keystore means Play will not accept future uploads signed
with a different key without a key-reset request to Google — back it up.

### Step 3 — GitHub Secrets (owner only, repo Settings > Secrets and variables > Actions)

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Contents of `upload-keystore.base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore (store) password chosen in Step 2 |
| `ANDROID_KEY_ALIAS` | `driver-saathi-upload` (or the alias chosen) |
| `ANDROID_KEY_PASSWORD` | Key password chosen in Step 2 |
| `GOOGLE_SERVICES_JSON_BASE64` | `base64 -w0 android/app/google-services.json` — use the file refreshed AFTER the SHA-1 trio is registered in Firebase console, otherwise native Google sign-in and FCM push will not work in the Play build |
| `PLAY_SERVICE_ACCOUNT_JSON` | Service-account JSON (below), pasted as plain text |

### Step 4 — Play service account (one time)

1. Google Cloud Console -> the project linked to Play Console -> Service
   Accounts -> Create (name e.g. `play-upload`), no role needed in Cloud.
2. Download its JSON key.
3. Play Console -> Users and permissions -> Invite new users -> paste the
   service-account email -> grant **Release manager** (Admin is NOT needed)
   -> Send invite. The account needs no acceptance step.
4. Paste the whole JSON file contents into the `PLAY_SERVICE_ACCOUNT_JSON`
   secret. This JSON is a credential: never commit it, never send it in chat.

## After the secrets are in place

1. Push any app-code change to `main` (or run the workflow manually from
   Actions -> Android Play Release -> Run workflow).
2. Watch the run in the Actions tab. Green = AAB built and, when the Play
   secret exists, uploaded to the Internal track.
3. Install the Internal build on a real phone (Play Console -> Internal
   testing -> tester link) and check: app opens without crash, Google login
   works, Home loads. Only then promote that release to Production in Play
   Console (Releases -> Promote release).
4. Users with Play auto-update ON get the new version automatically
   (Play rolls it out, usually within hours, not instantly). Users with
   auto-update OFF see Update in Play, plus the in-app UpdatePrompt banner.

## If a run fails

- "Keystore secrets are missing" -> Step 2/3 not done yet; add the secrets
  and re-run from the Actions tab (no new commit needed).
- "PLAY_SERVICE_ACCOUNT_JSON is not set" is a NOTICE, not a failure: the
  AAB artifact is still built. Upload it manually in Play Console, or add
  the secret and re-run.
- Gradle / Capacitor errors -> copy the failing step's log (not any secret)
  and fix the named file; the sandbox cannot run Gradle, so CI logs are
  the only way to debug these.
- "versionCode already exists" should not happen (run number is unique per
  workflow), unless a manual upload reused a versionCode — in that case
  re-run the workflow for a fresh number.

## Safety rules for this pipeline

- Never commit `android/`, `*.jks`, `key.properties`, `google-services.json`
  (the repo's `public/google-services.json` was deleted for this reason),
  or any service-account JSON.
- Never put a signing password, keystore, or service-account key in code,
  in a workflow file, in chat, or in a GitHub issue.
- Play uploads go to `internal` by default on push. Production uploads
  happen only via manual dispatch with track = production, or by promoting
  an Internal release inside Play Console — never automatically on push.


## Local (non-CI) debug APK builds — AdMob App ID (audit 2026-10-24)

Only the Play workflow injects `com.google.android.gms.ads.APPLICATION_ID`
into `AndroidManifest.xml`, and the app has crashed on launch without it.
For a local `cap sync` build, add this meta-data inside the
`<application>` tag of `android/app/src/main/AndroidManifest.xml`
BEFORE building, or the debug APK will crash on launch:

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-1994214977986364~6230883263" />
```
