# Project: Driver Saathi

## What this product does

Driver Saathi is a Hindi-first (5 languages: en/hi/mr/bn/kn) money + vehicle companion
for drivers in India: track earnings/expenses, debts/EMIs, savings goals, reminders,
car checks/documents, health logs, notes, an SOS page, and a marketplace. A "Car SOS"
feature lets a stranded driver request a nearby mechanic; the mechanic side lives in
a separate app, Mechanic Saathi, sharing the same Firebase project. An AI Assistant
and Finance AI exist in-app but their Cloud Functions are NOT deployed yet (Blaze
billing is pending on Google's side), so they currently fail gracefully.

## Stack (do not change without asking)

- Frontend: Vite + React 18 + TypeScript + shadcn/ui + Tailwind, React Query.
  Package manager is **bun** (`npm ci` fails on this repo; `bunx` is missing, use
  `bun x` for CLIs).
- Backend: Firebase project **driver-saathi-app** — Firestore (asia-south1,
  production mode), Firebase Auth (Email/Password + Google; Phone is enabled for
  the Mechanic app). There is NO custom backend server; the app talks to
  Firestore through `src/integrations/firebase/adapter.ts`, which mirrors the old
  Supabase API surface. Cloud Functions (AI Assistant, scheduled notifications,
  account delete) are STAGED in `firebase/` but NOT deployed — Blaze-gated.
- Android: Capacitor, appId `com.driversaathi.app`, appName "Driver Saathi".
  `capacitor.config.ts` uses **remote-load**: `server.url` is
  `https://driver-saathi.lovable.app`, so published WEB changes reach the
  installed app on next open. Only NATIVE changes (icon, name, permissions,
  plugins, server.url) need a new AAB.
- Hosting: Lovable — live site `https://driver-saathi.lovable.app`. The Lovable
  project is owned by a separate account (razakhan.chino@proton.me), NOT the
  GitHub/Google account (altafraza7384@gmail.com).
- Monetization (planned, not live): paid subscription (monthly + yearly, charged
  only when AI features are used) + AdMob ads. AdMob primary app "Driver
  saathi", banner unit ending …/7524617781; `app-ads.txt` is live. Payments
  (Razorpay) are NOT integrated yet; plans shown in-app are display-only.
  Insurance leads (Phase 1, 2026-10-22, user-approved): Driver Saathi does
  NOT sell insurance or collect premiums. A marketplace insurance card opens
  `/insurance`, where the user shares contact details ONCE with explicit
  consent for a quote from a licensed insurance partner; the partner does
  solicitation/quoting/sale and pays a lead/marketing fee under a written
  agreement (per-policy commission in Driver Saathi's own name would need
  a POSP licence — not held). Leads live in private `insurance_leads`
  (owner + admin read only; admin-only status/commission updates; user
  create requires consent == true and status == 'new' and forbids
  commission fields). Admin page `/admin/insurance-leads` (English only)
  tracks status + commission for monthly reconciliation against the
  partner's statement by lead ID. BEFORE GOING LIVE with a real partner:
  replace the generic "licensed insurance partner" wording with the
  partner's actual name + licence no., and update the Privacy Policy to
  name the partner and the shared fields. Phase 2 (after Blaze) automates
  forwarding via a Cloud Function webhook; Phase 1 forwarding is manual.
  Play pipeline (2026-10-22, user-approved, Actions unparked):
  `.github/workflows/android-play-release.yml` builds a signed AAB from
  main on app-code pushes (and on manual dispatch) and uploads it to Play
  (default track internal; production only via manual dispatch or by
  promoting an Internal release in Play Console). android/ is generated
  in the runner, never committed; versionCode = GitHub run number.
  Secrets are owner-added only (keystore + Play service account +
  google-services.json, see docs/PLAY_PIPELINE.md) — never in code, chat
  or logs. The first Play listing + review cannot be automated and must
  be done in Play Console first. Web changes still go live via Lovable
  publish, not via this workflow.
  Announcements (2026-10-22, user-approved): admin page
  `/admin/announcements` (English only) creates `announcements` (title,
  message, type news|offer, audience all|non_subscribers, is_active,
  expires_at); signed-in users read, only admins write. Home shows the
  banner (X hides it per user) + a once-per-announcement popup dialog
  (Close X/Close button; offer popups link to /more plans). Non-subscriber
  = users/{uid}.subscription_plan_id empty; audience filtering is
  client-side and NOT a security boundary (content is public to signed-in
  users by design). Closed-app native push: `sendAnnouncementPush` in
  firebase/functions (onCreate, active-only, FCM via Admin SDK, audience
  filter, dead-token cleanup) is STAGED ONLY — it deploys only after
  Blaze, because Functions cannot deploy on Spark. Never put an FCM
  server key in client code to work around this.

## Rules

- Never commit server secrets. The only keys in the repo/bundle are publishable
  Firebase client keys and the Supabase anon key (verified by a full exposure
  scan). The user's Gemini API key must NEVER go in chat or in app code — it
  will be set as the Functions secret `GOOGLE_AI_API_KEY` at deploy time only.
- `.env` STAYS TRACKED in this repo: Lovable builds read it and Lovable has no
  env-vars settings (deleting it once blanked the live site; rolled back).
- Every new Firestore collection must be registered in ONE place: the adapter's
  `TOP_LEVEL_TABLES` (top-level) or the per-user subcollections list, PLUS a
  matching type in `src/integrations/supabase/types.ts` (the db client is cast
  to SupabaseClient), PLUS a Firestore rules entry. Forgetting any of the three
  breaks reads or writes.
- Every mutation must invalidate the Home/bell React Query keys, or dashboards
  go stale for 5 minutes (past bug, fixed 2026-10-20 — do not regress it).
- Dates/times: NEVER use native `<input type="date">` / `"time">` — they do not
  open in the WebView. Always use the shared `src/components/ui/date-picker.tsx`
  and `time-picker.tsx` dialogs. Dates display like "28 Oct 2026"; storage
  formats are unchanged.
- Firestore adapter gotchas (past silent bugs — do not reintroduce):
  - `.eq("id", docId)` filters map to `where(documentId(), …)` because Firestore
    docs store no `id` field; a plain `where("id","==",…)` silently no-ops.
  - Debts must be created WITH `total_paid` / `is_active` / `start_date` defaults
    (they were Supabase column defaults; missing values render ₹NaN).
  - Money rendering must coerce via `src/lib/currency.ts`; the adapter's
    `clean()` drops NaN.
- Admin panel (`/admin`, English only): role-gated by a `roles/{uid}` doc with
  `roles: ["admin"]` (created via the Firebase console — client writes to
  `roles` are denied by rules, by design). Admin-managed fields are field-scoped
  in rules: users cannot set `is_blocked`/`subscription_plan_id`, mechanics
  cannot set `status`/`warnings`/`warning_history`/`held_at`/`held_reason`, and a
  held mechanic cannot accept SOS requests (server-side, not just UI). Admin
  pages must NOT use the bottom navigation: `ProtectedRoutes` returns a bare
  `<Outlet />` for `/admin` paths (admin has its own Back buttons + dashboard
  links). Admin pages are hardcoded English — no i18n keys for admin.
- Language: the user-facing app supports en/hi/mr/bn/kn with IDENTICAL key sets
  in `src/lib/i18n.tsx` (interpolation via `{var}`); any new UI string needs
  all 5 languages or the key-parity check fails. Deliberately left in English:
  Privacy Policy legal text, example placeholders, the SOS message sent to
  contacts, auth error details, the "DELETE" confirmation word, version string.
- Never ask the user for passwords, OTPs, or keystore secrets in chat. The
  keystore is generated and kept on the user's own computer only; logins go
  through the Secure Vault / the user's own browser session.
- Ask before adding a new dependency. Prefer small, reviewable changes; one
  feature per commit.
- Run typecheck, tests, and build before saying a task is done, and show the
  output. Never edit a test to make it pass — fix the code.

## Commands

- Install: `bun install`
- Typecheck: `bun x tsc --noEmit`
- Tests: `bun run test` (15 tests)
- Build: `bun run build` (emits `dist/` + `dist/version.json`)
- Android sync (after a fresh clone + build): `bun x cap add android`,
  place `google-services.json` in `android/app/`, then `bun x cap sync android`

## How work ships (do not improvise a different route)

- The sandbox GitHub App token is READ-ONLY and `git push` has no credentials.
  All GitHub writes go through the **GitHub web UI in the signed-in browser**,
  one file per commit, direct to `main` (keep each browser task to ~7 files;
  a 12-file task died on output limits).
- **Every GitHub upload is followed by a Lovable publish** so the live site
  updates (user's explicit standing instruction). Publish is a separate manual
  step in Lovable after it syncs from GitHub.
- **GitHub Actions cloud builds are PARKED.** The user said "bolunga tabhi
  karna" — do NOT start or unpark them until he explicitly says so.
- Firestore rules live in `firebase/firestore.rules` AND must be published
  separately in the Firebase console (repo copy alone changes nothing live).
  Same for Firestore indexes (10 exist live).
- Android packages are built as zips for the user to build on his own computer
  (the sandbox cannot run Gradle: JVM loopback TCP is intercepted; toolchains
  live under `~`, and `sdkmanager` is unusable — download artifacts with curl).
  Browser tasks CANNOT open localhost, so local web-flow tests must run on the
  user's machine or a public URL, never via a browser task against localhost.

## Architecture decisions (short log)

- 2026-10-20 Supabase → Firebase migration (Firestore + Auth, owner-locked
  rules). Supabase still exists with test data only; its code path remains
  behind the `backend` flag but is not maintained.
- Data model: `users/{uid}` profile doc + per-user subcollections
  (transactions, debts, debt_payments, goals, notes, reminders, car_checks,
  car_documents, health_logs, emergency_contacts, platform_affiliations,
  push_subscriptions, chat_messages, recurring_expenses,
  recurring_expense_payments). Top-level collections: marketplace_posts,
  marketplace_categories, subscription_plans, offers, config, roles,
  sos_requests, sos_request_details, mechanics, insurance_leads,
  announcements.
- Car SOS privacy model: `sos_requests` is public but carries ONLY approx
  coords (~1.1 km rounding) + geohash — no phone, no exact location.
  `sos_request_details` holds the phone + exact coords, readable only by the
  driver or the assigned mechanic. Both docs share one client-generated UUID.
- Mechanic Saathi is a SEPARATE app + repo (not a Lovable edit), same Firebase
  project, launch area Mumbai first. It reads/writes the shared `mechanics`,
  `sos_requests`, `sos_request_details` collections.
- Custom domain: DECIDED 2026-10-22 — keep `driver-saathi.lovable.app`. No
  domain switch (it would force an APK/AAB rebuild + Firebase authorized-domain
  + app-ads.txt changes).
- Known leftovers (do not "fix" without asking): `src/lib/backend.ts`
  statically imports both backends, so vendor-supabase (~172 KB) ships in
  Firebase builds; signup still shows the old "check your email" toast without
  auto-entering the app (login right after works); App Check is off; minimum
  password is 6 chars; account delete is Blaze-gated.
