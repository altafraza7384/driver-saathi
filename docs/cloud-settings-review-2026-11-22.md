# Cloud settings review — Bundle C (read-only) — 2026-11-22

**Scope:** read-only review of cloud settings for Driver Saathi. **Nothing in this
branch is applied live.** The only file change besides this report is the
`fieldOverrides` entry for the missing `aiUsage` index in
`firebase/firestore.indexes.json` — a repo-file patch only. It is NOT deployed,
no index is created in the console, no rules change, no secret is rotated, no
cleanup is run, no paid test is run. The branch waits for cost/effects approval
before anything is applied.

**Base:** `main` at `579d353` (PR #27 merged 2026-11-22 ~15:28 IST).
**Branch:** `review/cloud-settings-2026-11-22`.
**Starting evidence:** `~/workspace/goals/driver-saathi-security-audit/files/muse-aiusage-index-proof-2026-11-22.md`
(live 03:00 IST `FAILED_PRECONDITION` error + exact live/repo index config,
checked 2026-11-22 ~13:54 IST).

---

## 1. Database, billing, usage — what the repo/config can say

### Database edition / location

| Item | Value (repo-derived) | Basis |
|---|---|---|
| Firestore location | `asia-south1` (Mumbai) | `REGION = "asia-south1"` in `firebase/functions/src/index.ts:21`, `earningsNudge.ts:7`, `ai.ts`; `AGENTS.md` |
| Database ID | `(default)` | Proof note (console, 2026-11-22) |
| Edition | **Standard** (default). Nothing in the repo opts into Enterprise: no MongoDB-compatible queries, no Enterprise-only features anywhere in `firebase/` or `src/`. | Absence of any Enterprise configuration in repo; Standard is the default edition. Console confirmation is PENDING (see §5). |

### Billing currency — PENDING

The repo contains **no billing record at all**: a grep for `Blaze`/`budget` across
`docs/` and `firebase/` finds only stale prerequisite mentions
(`firebase/README.md` — "Upgrade to Blaze plan (needed for Functions…)").
Billing currency, current spend, and budget-alert state are console-only and
are **PENDING** (§5). Known from the coordinator's record (not re-verified
here): Blaze was activated 2026-10-30 with a ₹100 budget alert. That alert
cannot be confirmed from the repo — its existence/state is PENDING too.

### Available usage — PENDING (console numbers)

Current usage / remaining quota cannot be derived from the repo. For scale,
the public Firestore pricing page (Standard edition) gives the Blaze free tier
that applies before any charge: **50,000 reads, 20,000 writes, 20,000 deletes
per day, 1 GiB stored data**. Whether current usage sits inside that tier is
PENDING — it needs the console's usage page. At test-only scale (no real users
yet, only test accounts) the app is far inside it by construction; that is an
inference from scale, not a measured usage figure.

---

## 2. Cost estimate — the missing index + resumed cleanup

**Method:** no full data scan, no paid Query Explain. The estimate is derived
from the code's own data model plus public Firestore pricing, and is given as
a range, not a false precise figure.

### What the index holds

`firebase/functions/src/shared.ts:49-54` (`consumeQuota`): one `aiUsage` doc
per user, per feature (`chat`, `financeAi`), per hour — doc id
`<feature>_<ISO hour>`, 3 small fields (`feature`, `bucket_start`,
`request_count`). `cleanupTransactions`
(`firebase/functions/src/index.ts:345-362`) deletes buckets older than 48h,
so the collection can never hold more than ~48 hourly buckets per user per
feature. With a test-only user base (single-digit accounts), the live
collection is at most a few hundred docs; each doc is ~100–200 bytes
including Firestore overhead. Even at a generous upper bound (10 users ×
2 features × 48 buckets = 960 docs), data is **< 200 KiB** and the index
itself (one entry per doc: collection ID + timestamp + doc name, ~100–150
bytes each) is **< 200 KiB**. Total < 0.5 MiB — about 0.05% of the 1 GiB
free storage tier.

### Public pricing used (Firestore, Standard edition, Mumbai `asia-south1`)

Checked 2026-11-22 via Google's Firestore pricing page and a Mumbai-specific
cross-check: reads **$0.03 / 100,000**, writes **$0.09 / 100,000**, deletes
**$0.01 / 100,000**; stored data **from $0.15 / GiB/month** (Google's page,
"starting at"; the Mumbai-specific figure seen is $0.104 / GiB/month — hence
the range below). Free tier per day: 50K reads, 20K writes, 20K deletes,
1 GiB storage.

### Estimate

| Item | Cost |
|---|---|
| One-time index build (backfill reads of the existing docs, a few hundred at most) | **₹0** — inside the 50K/day free reads |
| Index storage, ongoing (< 0.5 MiB at $0.10–0.18 / GiB/month) | **< ₹0.01 / month**, inside the 1 GiB free tier → **₹0** |
| Resumed `cleanupTransactions`: 1 collection-group query + up to a few hundred deletes per night | **₹0** — inside the 20K/day free deletes |
| **Total, expected at current scale** | **₹0 / month** |
| Even at 100× current scale | **< ₹1 / month** (under $0.01) |

Billing currency is PENDING, so the INR figures above use the public USD
prices; the conclusion (effectively zero) does not depend on the currency.
**Cost is not a blocker for this index.** The blocker is approval, not money.

---

## 3. Findings

### F1 — The missing index (the reason this bundle exists)

- **Fact:** no index exists for collection group `aiUsage`, field
  `bucket_start`, ASCENDING, scope COLLECTION_GROUP — in neither the repo
  file (`grep -c aiUsage firebase/firestore.indexes.json` = 0 at base) nor
  live (proof note, console 2026-11-22).
- **Live impact (proven):** `cleanupTransactions` fails every night at
  03:00 IST with `9 FAILED_PRECONDITION: The query requires a
  COLLECTION_GROUP_ASC index for collection aiUsage and field bucket_start`
  (2026-11-22 03:00:02 + 03:00:06 IST, Cloud Scheduler job
  `firebase-schedule-cleanupTransactions-asia-south1`, schedule
  `0 3 * * *`, Asia/Kolkata, Enabled). Next failure: 2026-11-23 03:00 IST
  unless the index is created. Stale hourly quota buckets accumulate, and
  because the throw happens before `writer.close()`, the chat-message
  deletes queued earlier in the same run may never flush.
- **Proposed change (this branch, patch only — NOT applied):** add a
  `fieldOverrides` entry for `aiUsage` / `bucket_start` to
  `firebase/firestore.indexes.json` (see §4). **Cost: ₹0/month (§2).**
  Applying it later is one command — `firebase deploy --only
  firestore:indexes` from `firebase/` — which is an index deploy, not a
  rules deploy, and does not touch the rules HOLD. No TTL, no manual
  cleanup run, no blanket index deploy.

### F2 — App Check: not configured in code; enforcement state is console-only

- **Fact:** a repo-wide grep for `appCheck` / `AppCheck` /
  `initializeAppCheck` / `ReCaptcha` across `src/`, `firebase/`,
  `capacitor.config.ts` returns **nothing**. `AGENTS.md` confirms: "App
  Check is off". So no App Check provider (Play Integrity / reCAPTCHA v3)
  is wired into the web or native app.
- **Proposed change:** none now. The user's standing decision (2026-11-06)
  is to turn App Check ON + enforce **after Play Store publish**, not
  before (debug/sideload APKs could be blocked by Play Integrity). When
  that time comes: add Play Integrity (Android) + reCAPTCHA v3 (web) in
  `src/integrations/firebase/client.ts`, then enforce in the console.
  **Cost: $0** (App Check itself is free; reCAPTCHA v3 has a free tier
  that covers this scale).
- **PENDING:** current enforcement state in the console (expected: off /
  unenforced — to be confirmed, not assumed).

### F3 — API keys: public by design, restriction state is console-only

- **Fact:** `src/integrations/firebase/client.ts:19-26` builds the Firebase
  web config from `VITE_FIREBASE_*` env vars; the file's own comment says
  "These are public identifiers, not secrets." That is correct: a Firebase
  **web API key is public by design** — it identifies the project, it is
  not a credential. Security comes from Firestore rules + Auth, not from
  hiding the key. **Do not treat the tracked `.env`'s
  `VITE_FIREBASE_API_KEY` as a leaked privileged secret** — it is not one.
  The same applies to the Supabase publishable key in the tracked `.env`
  (`VITE_SUPABASE_PUBLISHABLE_KEY`): publishable by design, gated by RLS.
- **Proposed change (console-only, $0):** in Google Cloud Console → APIs &
  Services → Credentials, restrict the web API key to the APIs the app
  actually uses (Identity Toolkit, Firestore, Cloud Functions, Cloud
  Storage, FCM) and add HTTP-referrer restrictions for the web origin.
  **Care needed:** the native app loads `https://driver-saathi-app.web.app`
  via Capacitor remote-load, so the referrer allow-list must keep that
  origin working — verify on the installed app after any change, do not
  assume. No code change needed.
- **PENDING:** whether any API-key restriction exists in the console today.

### F4 — Supabase is still present (legacy, not live for the current build)

- **Fact:** the tracked `.env` has `VITE_BACKEND="firebase"`, so the live
  build uses Firebase. All Supabase calls sit behind the other branch of
  the backend switch: `src/pages/AssistantPage.tsx:192` and
  `src/pages/FinanceAIPage.tsx:111` fetch
  `…/functions/v1/chat` and `…/functions/v1/finance-ai` only when
  `BACKEND !== "firebase"`; `src/hooks/usePushNotifications.ts:67` fetches
  `…/functions/v1/send-notifications` only for the VAPID key on the
  Supabase branch (Firebase branch uses `VITE_VAPID_PUBLIC_KEY` from env).
  The Firebase counterparts (`src/lib/ai.ts` → callables `chat` /
  `financeAi`) are the live path. `supabase/` in the repo still holds the
  full legacy stack: `config.toml` (`project_id =
  "qtqgwqefuzylyyqxswwi"`), 6 edge functions (`admin-list-users`, `chat`,
  `cleanup-transactions`, `delete-account`, `finance-ai`,
  `send-notifications`), and migrations with owner-scoped RLS policies
  ("Users can view own …" etc.).
- **Notable:** the legacy Supabase `chat` / `finance-ai` edge functions
  read a `GOOGLE_AI_API_KEY` (Gemini) env var, while the Firebase functions
  use `GROQ_API_KEY` (`firebase/functions/src/ai.ts:7`). The repo's
  `.env.example` still lists the Supabase vars first. The old
  `AGENTS.md`/`firebase/README.md` text saying Firebase is "NOT live /
  NOT deployed" is stale — live verification 2026-11-22 shows 22/22
  functions deployed; the README status table was never updated.
- **Proposed change:** none now. After the Firebase cutover is proven on
  the user's phone, decide (user decision) whether to pause/delete the
  Supabase project or keep it as a fallback. **Cost: $0 if it sits on the
  free tier** — its actual plan/billable state is PENDING. Also proposed
  (docs-only, later bundle): update `firebase/README.md`'s stale "NOT
  live" status table and the deploy workflow's stale "Gemini via secret"
  header comment (code uses GROQ). Not applied in this branch — branch
  scope is the report + the index patch only.

### F5 — Secrets / IAM (names only — no values anywhere in the repo)

- **Fact:** 6 Secret Manager secrets are referenced by name in functions
  code (`defineSecret`): `GROQ_API_KEY` (`ai.ts:7`),
  `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (`index.ts:22-23`),
  `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (`razorpay.ts:11-12`),
  `RAZORPAY_WEBHOOK_SECRET` (`webhook.ts:10`). No secret value appears in
  the repo (only names + the publishable VAPID public key in `.env`).
  Deploys are keyless: `.github/workflows/firebase-functions-deploy.yml`
  uses Workload Identity Federation (pool `github`, project
  `282968056888`) as service account
  `firebase-hosting-deploy@driver-saathi-app.iam.gserviceaccount.com`;
  the workflow header lists the roles that account needs (Cloud Functions
  Admin, Service Account User, Storage Admin, Artifact Registry
  Administrator, Cloud Build Editor, Cloud Scheduler Admin, Secret Manager
  Admin, plus Service Usage Consumer + Firebase Hosting Admin already
  held). Functions run with `maxInstances: 10`
  (`firebase/functions/src/globalOptions.ts`) — a usage cap, not a cost
  item at this scale.
- **Proposed change:** none. **Cost: $0** (Secret Manager: 6 secrets, free
  tier covers them; WIF is free).
- **PENDING:** live IAM bindings on that service account, and confirmation
  that all 6 secrets exist with a version in Secret Manager (the
  coordinator's 2026-11-22 verification recorded all 6 as existing — not
  re-verified here).

### F6 — Incident-handling gaps in the scheduled jobs (code findings, $0 to fix later)

- **`cleanupTransactions` (`index.ts:345-362`) — the gap that bit:**
  no `try/catch`, no `retryCount`, no logging at all. The index failure
  threw mid-run, before `writer.close()`, so queued deletes never flushed,
  and the only trace was the Cloud Scheduler "Failed" status + 2 log lines
  found by manual log inspection. **Proposed (code change, later bundle,
  $0):** wrap each collection-group query in `try/catch` with a
  `console.error` naming the source — the exact pattern `sendNotifications`
  already uses (`index.ts`, per-source `try { … } catch (e) { console.error("sendNotifications: query failed", …); continue; }`) —
  plus `retryCount` and a one-line run summary log. Do not change the
  schedule or the retention rule (48h buckets / 24h chat messages).
- **`sendNotifications` (`index.ts:108+`) — good pattern, no change:**
  per-source isolation, summary log (`due/sent/alreadySent/noDevices/failed`),
  `retryCount: 2`. Its collection-group queries (`reminders`, `debts`,
  `goals`, `car_checks`, `car_documents`, `recurring_expenses`) all have
  matching indexes (proof note) — no index risk there.
- **`trialExpiryNudge` (`trialExpiryNudge.ts:142-146`) — good pattern, no
  change:** `retryCount: 2`, per-user exactly-once claim marker
  (`trial_expiry_push_log/{uid}_{milestone}` transaction), send failures
  logged, never thrown (so a retry cannot double-push). Gated by the
  `config/subscription_nudges.enabled` flag — OFF/missing sends nothing.
- **`earningsNudgeAfternoon` / `earningsNudgeNight`
  (`earningsNudge.ts:88-105`) — minor gap:** no `retryCount` and no
  `try/catch` around `getMessaging().sendEach`, so one FCM failure fails
  the whole job run. It does a full `users` collection scan per run, which
  is fine at test scale. **Proposed (later bundle, $0):** add the same
  per-batch error logging as `trialExpiryNudge`; no schedule/flag change.
- **`razorpayWebhook` (`webhook.ts`) — good pattern, no change:**
  HMAC signature verified with `RAZORPAY_WEBHOOK_SECRET`, idempotent via
  `webhook_events/{eventId}` transaction (processing + marker commit
  together), failures log + return 500 so Razorpay retries. Late events
  cannot recreate a deleted account or flip a `deleting` plan.
- None of these proposals changes any schedule, flag, or user-facing
  behaviour; all are $0 (logging + retries only).

### F7 — Scheduler jobs & opt-in flags: preserved, nothing changed

Verified from code — this branch changes **no** schedule, **no** flag, and
**no** function code at all (only the index file + this report):

| Job (Cloud Scheduler, per 2026-11-22 verification) | Schedule (Asia/Kolkata) | State |
|---|---|---|
| `sendNotifications` | every 5 minutes | Enabled, last run Success |
| `cleanupTransactions` | `0 3 * * *` | Enabled, last run **Failed** (missing index, F1) |
| `earningsNudgeAfternoon` | `0 15 * * *` | Enabled, last run Success |
| `earningsNudgeNight` | `30 21 * * *` | Enabled, last run Success |
| `trialExpiryNudge` | `0 10 * * *` | Enabled, last run Success |

- **Earnings nudge opt-in:** `users/{uid}.earnings_nudge_enabled`, OFF by
  default — a missing field is treated as `false`
  (`earningsNudge.ts:10-24`). Nobody is nudged unless they turned the
  toggle on in Settings. No flag is turned on by this bundle.
- **Routine reminders are device-local, not scheduler jobs:** the 7 daily
  routine reminders (`src/lib/routine.ts`: `SCHEDULE_KEYS = ["wake",
  "depart", "cp1", "cp2", "cp3", "cp4", "day_end"]`, 07:00–22:00 day shift)
  are scheduled on the phone itself via Capacitor `LocalNotifications`
  (`src/lib/routine.ts`, `src/lib/native-push.ts:152`). Saving a routine
  setting on web and delivery of the reminder on the native app are
  **separate tests — do not conflate them**. This bundle touches neither.
- **No duplicate jobs, no real push, no SOS test** in this bundle.

### F8 — Stale repo docs (noted, not fixed here)

`firebase/README.md`'s status table still says Firebase is "NOT live" and
functions are "NOT deployed"; the functions deploy workflow header still
says "Gemini via secret" while `ai.ts` uses `GROQ_API_KEY`. Both are
doc-only staleness, no functional effect. Proposed for a later docs pass;
out of scope for this branch.

---

## 4. The patch (repo file only — NOT applied live)

`firebase/firestore.indexes.json`, `fieldOverrides` — one entry added, all
11 existing indexes + the existing `reminders.notify_at` override preserved
byte-identical apart from the addition:

```json
{
  "collectionGroup": "aiUsage",
  "fieldPath": "bucket_start",
  "indexes": [
    { "order": "ASCENDING", "queryScope": "COLLECTION" },
    { "order": "DESCENDING", "queryScope": "COLLECTION" },
    { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" },
    { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
  ]
}
```

Why `fieldOverrides` and not the `indexes` array: the failing query needs a
**single-field collection-group** index, and live automatic index settings
have collection-group scope **Disabled** (proof note) — a field override is
the mechanism that enables it for this field. Why the entry lists the
collection-scope indexes too: a `fieldOverride` **replaces** the automatic
settings for that field, so listing only the collection-group entry would
silently turn off the automatic collection-scope indexes for
`bucket_start`. No collection-scoped query on `bucket_start` exists today
(the only query is the `collectionGroup` one in `cleanupTransactions`),
but keeping the collection-scope entries costs nothing at this scale and
avoids a future foot-gun if one is ever added. This mirrors the existing
`reminders.notify_at` override, which lists the same four entries.

**To apply later (after cost/effects approval — NOT done here):**
`firebase deploy --only firestore:indexes` from `firebase/` (index deploy
only; does not touch rules). The console path (Firestore → Indexes → Add
index, collection group `aiUsage`, `bucket_start` Ascending, collection-group
scope) is equivalent and needs no code change. Either way, the next
`cleanupTransactions` run (03:00 IST) should then succeed — verify from the
Scheduler job status + Functions logs, not from the deploy output alone.

---

## 5. PENDING — live-console checks (coordinator; cannot be verified from repo/docs)

| # | Item | Where to check |
|---|---|---|
| P1 | Billing currency (INR vs USD) + current spend to date | Google Cloud Console → Billing |
| P2 | Current Firestore usage (reads/writes/deletes/storage) vs free tier | Firebase console → Firestore → Usage |
| P3 | ₹100 budget alert — exists? enabled? triggered? | Cloud Console → Billing → Budgets & alerts |
| P4 | API-key restriction state (which APIs, which referrers) for the web API key | Cloud Console → APIs & Services → Credentials |
| P5 | App Check enforcement state (expected off/unenforced — confirm) | Firebase console → App Check |
| P6 | IAM bindings on `firebase-hosting-deploy@driver-saathi-app.iam.gserviceaccount.com` (roles listed in F5) | Cloud Console → IAM |
| P7 | All 6 Secret Manager secrets exist with a version (`GROQ_API_KEY`, `VAPID_*`, `RAZORPAY_*`) | Cloud Console → Secret Manager |
| P8 | Firestore edition confirmation (Standard) + database location `(default)` / `asia-south1` | Firebase console → Firestore → Data |
| P9 | Supabase project `qtqgwqefuzylyyqxswwi` — live/paused/deleted? plan? (F4 decision input) | Supabase dashboard |
| P10 | After the index is applied (future): index status Enabled + `cleanupTransactions` 03:00 run Success | Firebase console → Firestore → Indexes; Cloud Scheduler + Functions logs |

---

## 6. Proposed changes + costs (summary)

| # | Proposed change | Cost | Status |
|---|---|---|---|
| 1 | Add `aiUsage`/`bucket_start` COLLECTION_GROUP ASC index (fieldOverrides patch in this branch) | ₹0/month (§2) | **Patch ready, NOT applied** — needs cost/effects approval |
| 2 | Harden `cleanupTransactions` (per-query try/catch + log + retryCount, F6) | $0 | Proposed for a later bundle — not in this branch |
| 3 | Harden `earningsNudge` send (per-batch error logging, F6) | $0 | Proposed for a later bundle — not in this branch |
| 4 | Restrict web API key in console (APIs + referrers, F3) | $0 | Proposed, console-only — verify on installed app after |
| 5 | App Check on + enforce after Play publish (F2) | $0 | Per standing user decision — not now |
| 6 | Decide Supabase project fate after Firebase cutover proven (F4) | $0 if free tier | User decision — not now |
| 7 | Fix stale `firebase/README.md` status + workflow "Gemini" comment (F4/F8) | $0 | Docs-only, later pass |

**Nothing in this branch is applied live. Nothing is merged. No schedule,
flag, secret, rule, or console setting is changed by this bundle.**
