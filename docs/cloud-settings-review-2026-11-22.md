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

## Corrections applied — 2026-11-22 (post-review)

Each correction below first quotes the report's own wrong/misleading claim,
then the evidence that contradicts it, then what changed. The
`fieldOverrides` entry for `aiUsage` / `bucket_start` (§4) is unchanged by
all corrections in this log — it was verified correct and stays as-is. The 11
existing indexes, the Scheduler/opt-in facts (F7), and the P1–P10 pending
list are likewise preserved.

### C1 — Cost: confirmed ₹0/month and 100×-scale <₹1 claims withdrawn

- **Old claim (exact quotes, §2):** "| **Total, expected at current scale**
  | **₹0 / month** |" and "| Even at 100× current scale | **< ₹1 / month**
  (under $0.01) |".
- **Contradicting evidence:** the same report's §1 states billing currency
  is PENDING ("The repo contains no billing record at all"), current usage
  is PENDING ("cannot be derived from the repo"), and edition confirmation
  is PENDING (P8). The user count behind the estimate ("single-digit test
  accounts") is stated in §1 as "an inference from scale, not a measured
  usage figure". The backlog is unmeasured — cleanup has been failing daily
  (F1) and no scan was run to count it. And the free tier (50K reads / 20K
  writes / 20K deletes per day, 1 GiB storage) is **shared with the whole
  app** — every collection, every function, every user — so headroom for
  this index depends on all other usage that day, which is also unmeasured.
  A confirmed total cannot be derived from unmeasured inputs.
- **Correction:** §2 now gives conditional scenarios (A/B/C) from public
  rates plus the known console metadata only (asia-south1, Standard edition
  per repo — withdrawn by C5 below; cleanup failing daily), states the free tier is shared, and
  carries no confirmed ₹0 or 100× figure. F1 and §6 no longer repeat ₹0;
  they point at §2.

### C2 — 48h cutoff is NOT a retention guarantee

- **Old claim (exact quote, §2):** "`cleanupTransactions` deletes buckets
  older than 48h, so the collection can never hold more than ~48 hourly
  buckets per user per feature."
- **Contradicting evidence:** committed source
  `firebase/functions/src/index.ts:345-362` — the `aiUsage`
  collection-group query throws `FAILED_PRECONDITION` before
  `writer.close()`, so no deletes flush while the index is missing; the
  job has failed daily (proven 2026-11-22 03:00 IST, next failure
  2026-11-23 03:00 IST unless the index is created). While broken, each day
  adds up to 24 new buckets per user per feature and deletes none, so the
  collection grows without bound — the "~48 buckets" bound is false today.
  Even with a healthy daily 03:00 IST run: a bucket created just after
  03:00 is first eligible at the run ~48h later and is only deleted at the
  run after that, so it lives up to nearly 72h (same arithmetic: the 24h
  chat-message cutoff means messages live ~24h to ~48h).
- **Correction:** §2 now states retention as ~48h to just under 72h for
  buckets (~24h to ~48h for chat messages) under a healthy daily run, and
  unbounded while cleanup is broken. The first resumed run's reads,
  deletes, function charges, and user-facing effects are spelled out in
  §2 ("First resumed run"), and F1's impact note points at it.

### C3 — Whole-file indexes deploy is NOT a one-field-only change

- **Old claim (exact quote, §4):** "Applying it later is one command —
  `firebase deploy --only firestore:indexes` from `firebase/` — which is an
  index deploy, not a rules deploy, and does not touch the rules HOLD."
  (F1 added "no blanket index deploy" while §4 proposed exactly the
  whole-file deploy — the two contradicted each other.)
- **Contradicting evidence:** the command deploys the entire
  `firebase/firestore.indexes.json` — all 11 indexes + both
  fieldOverrides. Live and repo formats differ (proof note, console
  2026-11-22 ~13:54 IST): live shows 8 manual composite indexes + 4
  single-field exemptions (`car_documents / notify_at`,
  `chat_messages / created_at`, `reminders / notify_at`,
  `transactions / transaction_date`); the repo file lists 11 indexes + 1
  override. Reconciliation: live covers all 11 repo indexes — 8 as manual
  composites, and 3 (#3 `transactions / transaction_date` CG, #8
  `car_documents / notify_at` CG, #10 `chat_messages / created_at` CG)
  only as single-field exemptions. A whole-file deploy re-asserts all 11 +
  2 overrides and adds composite-index entries for those 3 — a
  representation change to existing settings, not a one-field change.
- **Correction:** §4 now reconciles live ↔ repo in a table, states the
  whole-file deploy's full scope honestly, and gives the narrowly-scoped
  route: console Firestore → Indexes → Add index for `aiUsage` /
  `bucket_start` ASC, collection-group scope — creates exactly one index
  and leaves all existing settings untouched. No manual cleanup, no TTL.
  F1's contradictory "no blanket index deploy" line is fixed.

### C4 — App Check-after-Play is NOT presented as an approved decision

- **Old claim (exact quotes, F2 and §6):** "The user's standing decision
  (2026-11-06) is to turn App Check ON + enforce **after Play Store
  publish**, not before (debug/sideload APKs could be blocked by Play
  Integrity)." (§6 row 5: "Per standing user decision — not now".)
- **Contradicting evidence:** no permission evidence or decision record for
  an App Check rollout was found in the repo — a grep for `appCheck` /
  `AppCheck` / `initializeAppCheck` / `ReCaptcha` across `docs/`,
  `AGENTS.md`, `firebase/README.md` returns only this report itself and
  the state note "App Check is off" in `AGENTS.md` (a statement of current
  state, not an approval). Enforcement state is console-only and PENDING
  (P5). Nothing in the repo authorises presenting the after-Play timing as
  an approved owner decision.
- **Correction:** F2 and §6 now state rollout timing is OPEN / pending
  explicit owner confirmation; do NOT enforce. The earlier after-Play
  wording is removed as an approved decision.

### Round 2 — 2026-11-22 (post-review corrections C5–C8)

### C5 — Firestore location and edition are UNKNOWN, not repo-derived

- **Old claims (exact quotes, §1):** "| Firestore location |
  `asia-south1` (Mumbai) |" and "| Edition | **Standard** (default).
  Nothing in the repo opts into Enterprise: no MongoDB-compatible queries,
  no Enterprise-only features anywhere in `firebase/` or `src/`. |". The
  same inference leaked into §2 ("Public pricing used (Firestore, Standard
  edition, Mumbai `asia-south1`)", "Edition is repo-derived Standard") and
  P8 ("Firestore edition confirmation (Standard) + database location
  `(default)` / `asia-south1`"), and into C1's summary line above
  ("asia-south1, Standard edition per repo").
- **Contradicting evidence — location:** every `asia-south1` string in the
  repo is a **Cloud Functions region**, not a Firestore database location:
  `REGION = "asia-south1"` in 8 Functions files (`index.ts:21`,
  `earningsNudge.ts:7`, `leads.ts:4`, `mechanicPhone.ts:12`,
  `razorpay.ts:10`, `sosPush.ts:6`, `trialExpiryNudge.ts:6`,
  `webhook.ts:9`) and `getFunctions(firebaseApp, "asia-south1")` in
  `src/integrations/firebase/client.ts:66`. No repo file records a
  Firestore database location: `firebase.json` has no `firestore` section
  at all (hosting only), there is no `.firebaserc` in the repo, and
  `firestore.rules` matches `/databases/{database}/documents` with no
  location. `AGENTS.md:18` repeats "Firestore (asia-south1…)" but cites no
  database metadata and appears to restate the Functions region — a repo
  note is not database metadata. The proof note records the console
  database as `(default)` (2026-11-22 ~13:54 IST) but records no location
  field for it. A Functions region does not determine a database location
  — the two are chosen independently.
- **Contradicting evidence — edition:** a repo-wide grep for `mongo` /
  `enterprise` across `firebase/`, `src/`, `docs/`, `AGENTS.md` returns
  nothing (one false positive: a weekday name in `aiLogic.ts:188`) — but
  absence of MongoDB-compatible code proves nothing about edition, because
  Firestore **Enterprise edition also offers Native mode**: the same
  Firestore API works on Enterprise without any MongoDB-compatible query.
  "Standard is the default edition" is not evidence about this database —
  edition is fixed when the database is created. No repo file, config, or
  checked console record states the edition.
- **Correction:** §1 now states both location and edition as **UNKNOWN**,
  with the evidence above and the check that settles each (P8). §2 pricing
  rates are now marked conditional on both (Standard-edition,
  `asia-south1` rates as checked — they apply only if P8 confirms both).
  P8 now asks for both as UNKNOWN items.

### C6 — At-most-~48-buckets bound removed

- **Old claims (exact quotes, §2):** "So the \"at most ~48 buckets per user
  per feature\" bound holds only while cleanup runs successfully every
  night — it does not hold today."; "the live collection would be at most a
  few hundred docs *if cleanup were healthy*"; "At the generous upper bound
  used for illustration only (10 users × 2 features × 48 buckets = 960
  docs), data is **< 200 KiB** … Total < 0.5 MiB — about 0.05% of the 1 GiB
  free storage tier"; and "at the generous upper bound used before (10 users
  × 2 features × 48 buckets = 960 docs), the backfill is 960 reads and the
  index is < 0.5 MiB".
- **Contradicting evidence:** the corrected retention range in C2 itself —
  a bucket created just after the 03:00 run lives up to nearly 72h under a
  healthy daily run, i.e. up to nearly 72 hourly buckets per user per
  feature, not ~48. The ~48 figure was the 48h **cutoff**, not the
  retention: a bucket first becomes eligible ~48h after creation and is
  only deleted at the next run after that. And today cleanup is broken, so
  the count grows without bound — no healthy-night bound applies at all.
  The 960-doc total and the < 0.5 MiB size were arithmetic on the false
  bound plus an unmeasured 10-user base (user count is an inference, not a
  measured count — see C1).
- **Correction:** every at-most-~48-buckets statement is removed; no
  per-user bucket-count bound is stated. The 960-doc illustration and its
  size totals are withdrawn; the live count and total size are stated as
  unmeasured until the backlog is counted (P2 or a read-only count). The
  ~48h-to-just-under-72h retention range (C2) is kept — it is a lifetime
  range, not a count bound. The quoted old claim inside C2's own entry is a
  quote of the withdrawn claim, not a live statement.

### C7 — Backlog/headroom unmeasured: cost stays conditional

- **Old claim (exact quote, §2 scenario B):** "Backfill: one read per
  existing `aiUsage` doc at $0.03/100K; nightly cleanup: one delete per
  stale bucket at $0.01/100K; storage: index size × $0.10–0.18/GiB/month —
  small in absolute terms at any measured backlog, but NOT ₹0 by assertion".
- **Contradicting evidence:** "at any measured backlog" assumes a measured
  backlog, but the backlog is unmeasured — cleanup has been failing daily
  (F1) and no scan was run to count it (C1). Free-tier headroom is likewise
  unmeasured (P2), and the free tier is shared with the whole app (C1), so
  no absolute size ("small") can be asserted for this index's cost. The
  960-doc illustration that previously anchored an absolute size was
  withdrawn by C6.
- **Correction:** scenario B now states the cost scales with the backlog,
  which is unmeasured, so no absolute figure is stated. An explicit line is
  added in §2: backlog size and free-tier headroom are both unmeasured, so
  cost stays conditional — the scenarios are the whole cost statement, no
  total, not even an illustrative one, is confirmed. No confirmed cost
  figure is reintroduced anywhere.

### C8 — Single-field route only: whole-file deploy is NOT the route

- **Old claims (exact quotes):** F1 — "Applying it later is either the
  narrow console route (one index only) or a whole-file `firebase deploy
  --only firestore:indexes` — see §4; the whole-file deploy is NOT a
  one-field-only change."; §4 — "**To apply later … — two routes, not
  one:**" and "Use it only if the whole-file state is what is wanted; do
  not describe it as one-field-only."
- **Contradicting evidence:** the live ↔ repo reconciliation from round 1
  (proof note, console 2026-11-22 ~13:54 IST): live holds 8 manual
  composite indexes, all Enabled, + 4 single-field exemptions
  (`car_documents / notify_at`, `chat_messages / created_at`,
  `reminders / notify_at`, `transactions / transaction_date`); the repo
  file lists 11 indexes + 1 override (+1 new in this branch). Three repo
  entries (#3 `transactions / transaction_date` CG, #8 `car_documents /
  notify_at` CG, #10 `chat_messages / created_at` CG) exist live ONLY as
  single-field exemptions. A whole-file deploy re-asserts all 11 indexes +
  both overrides and adds composite-index entries for those three — a
  representation change to existing live settings, not a one-field change —
  so presenting it as a co-equal apply route contradicts the "leaves every
  existing setting untouched" requirement for this one-field change. The
  narrow console route creates exactly one index and touches nothing else.
- **Correction:** §4 now has ONE verified route — the narrow console
  Add-index — with an explicit preservation sentence naming the 8 manual
  indexes + 4 exemptions it leaves untouched (#3, #8, #10 stay exemptions,
  NOT converted to composites). The whole-file deploy is demoted from an
  alternative to an explicit do-NOT-use for this change; F1 now says
  narrow-route-only. No TTL, no manual cleanup run, no blanket indexes
  deploy. C3's scope statement (whole-file deploy = full-file scope) is
  preserved as the reason it is not the route.

### Round 3 — 2026-11-23 (post-review corrections C9–C10)

### C9 — BulkWriter: "chat deletes never flushed" is withdrawn — chat-delete completion is UNKNOWN

- **Old claims (exact quotes):** F6 — "threw mid-run, before
  `writer.close()`, so queued deletes never flushed"; F1 — "because the
  throw happens before `writer.close()`, the chat-message deletes queued
  earlier in the same run may never flush — so stale chat messages
  accumulate too"; §2 ("First resumed run") — "(the chat deletes queued
  before the throw never flushed either, so stale chat messages have been
  accumulating too)"; C2's evidence — "so no deletes flush while the index
  is missing".
- **Contradicting evidence — code order:** `firebase/functions/src/index.ts:345-362`
  (`cleanupTransactions`): the `chat_messages` collection-group query runs
  and its `writer.delete()` calls are enqueued FIRST; the `aiUsage` query
  runs SECOND and throws `FAILED_PRECONDITION` before its own `forEach`,
  so no `aiUsage` delete is ever enqueued. Zero `aiUsage` deletes is
  sound — the query fails before any delete is scheduled. The chat
  deletes, by contrast, ARE enqueued before the throw, so their fate
  cannot be read off the throw.
- **Contradicting evidence — BulkWriter behaviour:** BulkWriter schedules
  sends as soon as full batches enqueue — `close()` is not the gate for
  already-enqueued batches. The Node.js BulkWriter reference states
  `close()` "Commits all enqueued writes and marks the BulkWriter
  instance as closed" and "Calling this method will send all requests" —
  i.e. `close()` flushes the REMAINING buffered operations; it does not
  decide whether already-enqueued batches were sent. Local SDK probe
  (supplied 2026-11-23, installed `@google-cloud/firestore` 7.11.6,
  locked in `firebase/functions/package-lock.json`): 20 fake deletes
  scheduled one batch without `close()`; the send was intercepted before
  the network — the batch was dispatched with `close()` never called.
- **Correction:** a failed cleanup run does NOT let you infer actual chat
  deletions or a chat backlog. Chat-delete completion, count, and backlog
  are UNKNOWN until logs/count evidence exists — no manual cleanup, no new
  paid scan. What stays KNOWN: the `aiUsage` query fails with
  `FAILED_PRECONDITION` on every 03:00 IST run (proven 2026-11-22 03:00
  IST, F1); no `aiUsage` delete is ever enqueued, so `aiUsage` buckets
  accumulate without bound; the `aiUsage` backlog size is unmeasured. §2
  ("First resumed run"), F1, and F6 now state the chat side as UNKNOWN.
  C2's sentence ("so no deletes flush while the index is missing") is
  superseded wording, not a live statement: it holds for `aiUsage`
  deletes (never enqueued) and is withdrawn for chat deletes. C2's
  retention range for a HEALTHY run (~48h to just under 72h for buckets,
  ~24h to ~48h for chat messages) is unaffected — it describes runs that
  reach `writer.close()`, not the broken runs.

### C10 — Narrow route is "Add Exemption" (Single Field / automatic), NOT a "verified Add Index"

- **Old claims (exact quotes):** §4 — "**Narrow route (the verified route
  for this one-field change):** Firebase console → Firestore → Indexes →
  Add index, collection group `aiUsage`, `bucket_start` Ascending,
  collection-group scope."; C8 — "§4 now has ONE verified route — the
  narrow console Add-index"; §4 (do-NOT-use bullet) — "It is not the
  verified route for adding this one index."; C3 — "console Firestore →
  Indexes → Add index for `aiUsage` / `bucket_start` ASC,
  collection-group scope".
- **Contradicting evidence — "verified" was never earned:** no live-browser
  check of the console labels or preview for this path has run on project
  `driver-saathi-app`. The route's console wording is therefore NOT
  console-verified; calling it "the verified route" overstates the
  evidence. Console-label proof needs the read-only browser task briefed
  below — until that proof exists, the route is the route, not a verified
  route.
- **Contradicting evidence — the path is "Add Exemption", not "Add
  Index":** the Firebase blog on collection-group queries (2019-06-20)
  describes the console path as Firestore → Index tab → Single Field
  section → "Add exemption" button, specifying the collection, the field,
  and a "collection group" scope, then enabling ascending and/or
  descending. The Cloud docs ("Manage Standard edition indexes") give the
  same path as Databases → select database → Indexes → **Automatic** tab
  → **Add Exemption** → Collection ID + Field path → select settings →
  Save Exemption; the index overview confirms automatic indexes with
  collection-group scope are not maintained by default and an exemption
  overrides the automatic settings for that field. "Add Index" / "Create
  Index" is the Manual-tab composite route (Indexes → **Manual** tab →
  Create Index, Collection ID + fields + index mode) — a DIFFERENT route
  from the Single Field Add Exemption route. The whole-file `firebase
  deploy --only firestore:indexes` is a third, different route (already
  demoted by C8).
- **Correction:** §4 now names the route exactly — Single Field /
  automatic indexes, **Add Exemption**: Collection ID `aiUsage`, Field
  path `bucket_start`, COLLECTION_GROUP Ascending, preserving existing
  settings (the collection-scope Ascending / Descending / array-contains
  entries stay as in the repo `fieldOverrides` entry) — and drops
  "verified" from the route. The three routes (Add Exemption;
  manual/composite Add Index; whole-file deploy) are kept explicitly
  separate in §4; only Add Exemption is the route. F1 now says Add
  Exemption route only. What IS verified stays verified: the repo
  `fieldOverrides` entry (§4, unchanged), the live↔repo reconciliation (8
  manual composites + 4 exemptions), and that a whole-file deploy is not
  one-field-only (C3/C8). The quoted "Add index" / "verified route"
  wording inside the C3 and C8 entries is superseded wording, not a live
  statement.
- **Console-label proof — browser-task brief (read-only, NOT run here;
  coordinator to hand to a browser-capable agent):** sign in as
  `altafraza7384@gmail.com` (the GitHub/Google account — NOT
  `razakhan.chino@proton.me`, the Lovable account) on project
  `driver-saathi-app`, database `(default)`. Go to Firebase console →
  Firestore → Indexes → **Automatic** tab → **Add Exemption** (if the
  console shows the older "Single Field" section naming instead, record
  the exact labels as shown). Fill Collection ID `aiUsage`, Field path
  `bucket_start`; record verbatim every label, toggle/checkbox, scope
  option, and preview/summary text the form shows, and which existing
  settings it shows as preserved (collection-scope Ascending / Descending
  / array-contains). Then CLOSE/CANCEL the dialog WITHOUT saving — do NOT
  click Save Exemption, do NOT create any index, do NOT change anything
  else. Afterwards re-check the exemptions list and confirm no `aiUsage`
  entry was created. Record screenshots or verbatim text of (a) the
  Indexes page tabs (Automatic vs Manual), (b) the Add Exemption form
  fields and defaults, (c) any preview/summary line showing what would be
  created, (d) confirmation the dialog was closed unsaved and nothing was
  applied. Stop and report if sign-in fails or the console UI differs
  from this brief — do not improvise a different route.

---

## 1. Database, billing, usage — what the repo/config can say

### Database edition / location

| Item | Value (repo-derived) | Basis |
|---|---|---|
| Firestore location | **UNKNOWN** | No repo file records a Firestore database location (see C5). Every `asia-south1` in the repo is a Cloud Functions region. Settles via P8. |
| Database ID | `(default)` | Proof note (console, 2026-11-22) |
| Edition | **UNKNOWN** | No repo file, config, or checked console record states the edition (see C5). Absence of MongoDB-compatible code proves nothing — Enterprise also offers Native mode. Settles via P8. |

What settles them (P8): Firebase console → Firestore → Data shows the
database `(default)` location and edition, or `gcloud firestore databases
describe --database='(default)' --project=driver-saathi-app`
(`locationId`, `databaseEdition`). Until that check runs, both stay
UNKNOWN and every rate in §2 stays conditional.

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
the public Firestore pricing page for the Standard edition lists a free tier
of **50,000 reads, 20,000 writes, 20,000 deletes per day, 1 GiB stored
data** — but those figures apply only if the database is Standard, and
edition is **UNKNOWN** until P8 (see C5), so this is conditional, not a
confirmed tier for this database. Whether current usage sits inside that tier is
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
(`firebase/functions/src/index.ts:345-362`) deletes buckets older than 48h —
but 48h is a **cutoff, not a retention guarantee** (see C2 above): while the
job is broken the backlog grows without bound, and even with a healthy daily
03:00 IST run a bucket lives **~48h to just under 72h** before deletion (a
bucket created just after 03:00 is only deleted at the third run after its
creation; the same arithmetic gives chat messages ~24h to ~48h). No
per-user bucket-count bound is stated: the live count is unmeasured —
cleanup has been failing daily, so the backlog is unknown and larger than a
healthy nightly run would leave, and the user count is an inference
(single-digit test accounts), not a measured count. Each doc is ~100–200
bytes including Firestore overhead (from the data model: 3 small fields per
doc), but without a counted backlog no total size is stated.

### Public pricing used (Firestore, Standard edition, Mumbai `asia-south1` — both conditional until P8; see C5)

Checked 2026-11-22 via Google's Firestore pricing page and a Mumbai-specific
cross-check: reads **$0.03 / 100,000**, writes **$0.09 / 100,000**, deletes
**$0.01 / 100,000**; stored data **from $0.15 / GiB/month** (Google's page,
"starting at"; the Mumbai-specific figure seen is $0.104 / GiB/month — hence
the range below). Free tier per day: 50K reads, 20K writes, 20K deletes,
1 GiB storage. These are the Standard-edition, `asia-south1` rates as
checked. Both inputs are **UNKNOWN** until P8 (see C5): if the database is
Enterprise or in another location, different rates apply — so every rate in
this section is conditional.

### Estimate — WITHDRAWN as a confirmed figure; conditional scenarios only

The previous version of this section stated a confirmed **₹0 / month**
total and **< ₹1 / month at 100× scale**. Both claims are WITHDRAWN. They
cannot be confirmed from the evidence available to this review:

- Billing currency is PENDING (P1) — the INR figures were converted from
  public USD prices, not from a bill.
- Actual usage vs the free tier is PENDING (P2) — no console usage figure
  was available, so free-tier headroom is unknown.
- Edition is **UNKNOWN** until P8 — the repo cannot show it (see C5); the
  Standard-edition rates in this section are conditional on that check.
- User count is unverified — "single-digit test accounts" is an inference
  from scale, not a count from the console or a data scan.
- Backlog size is unverified — cleanup has been failing daily (F1), so the
  stale-bucket backlog is unknown; no scan was run to measure it.
- The free tier is **shared with the whole app**: the 50K reads / 20K
  writes / 20K deletes per day and 1 GiB storage cover every collection,
  every function, and every user — not this index alone. Headroom for this
  index depends on everything else the app does that day.

What CAN be stated (public Firestore pricing for the Standard edition in
`asia-south1`, checked 2026-11-22 — **both inputs UNKNOWN until P8, see
C5**, so these rates apply only if the database is Standard in
`asia-south1`): reads $0.03 / 100,000, writes $0.09 /
100,000, deletes $0.01 / 100,000; stored data from $0.10–0.18 / GiB/month;
free tier per day: 50K reads, 20K writes, 20K deletes, 1 GiB storage.
These are rates, not a bill.

Conditional scenarios (each is conditional on the PENDING items above):

| Scenario | Condition | Cost of this index |
|---|---|---|
| A — usage well inside free tier | Console usage (P2) shows the app well inside the daily free tier, with headroom for the backfill reads + nightly deletes | ₹0 for this index (no charge arises) |
| B — usage at/over free tier | Usage is at or over the free tier, so marginal reads/writes/deletes are billed | Backfill: one read per existing `aiUsage` doc at $0.03/100K; nightly cleanup: one delete per stale bucket at $0.01/100K; storage: index size × $0.10–0.18/GiB/month — the cost scales with the backlog, which is unmeasured, so no absolute figure is stated, and it is NOT ₹0 by assertion |
| C — backlog unknown | Backlog never measured | The cost of the first resumed cleanup run cannot be stated until the backlog is counted (console usage page, P2, or a read-only count) |

No backlog total is stated. The 960-doc figure used before is withdrawn: it
was built on the ~48-bucket bound (withdrawn above) and a 10-user base that
is unmeasured, and the backlog after days of failed cleanup is by definition
larger than what a healthy nightly run would leave (see the retention
correction, C2). Do not use 960 as a backlog figure — the backlog can only
be stated after a count (console usage page, P2, or a read-only count).

**Cost is not proven to be a blocker, and not proven to be zero either.**
Backlog size and free-tier headroom are both unmeasured (P2), so cost stays
conditional: the scenarios above are the whole cost statement — no total,
not even an illustrative one, is confirmed.
The blocker remains approval — plus the PENDING console checks P1/P2 that
would turn these scenarios into a number.

### First resumed run — what it will read, delete, and cost

Once the index exists, the next 03:00 IST run reads and deletes the
accumulated backlog in one run — not a normal night's worth. The `aiUsage`
backlog is known to have accumulated (no `aiUsage` delete is ever enqueued
while the query fails — see C9); the `chat_messages` backlog is UNKNOWN
(chat deletes were enqueued before the throw and may have flushed — see
C9), so the chat side of the first resumed run cannot be sized in advance:

- **Reads:** one collection-group query read per stale `aiUsage` doc, plus
  one per stale `chat_messages` doc that is still present — how many stale
  chat messages remain is UNKNOWN (see C9). Exact counts equal the backlog
  size, which is unmeasured.
- **Deletes:** one delete per stale doc still present via `bulkWriter`, then the normal
  nightly deletes thereafter.
- **Function charges:** one scheduled invocation + the compute time of a
  longer-than-normal run (a large backlog means a longer run). Billed at
  the public rates in §2 if outside the shared free tier — conditional on
  P1/P2, like everything else in §2.
- **Effects on users:** none on live quota — `consumeQuota` only ever reads
  the current hour's bucket, and only buckets older than 48h are deleted.
  Chat messages older than 24h are deleted as designed (chat history, not
  money data — transaction deletion was removed 2026-10-24). No document
  newer than the cutoffs is touched. The run does not change any schedule,
  flag, or user-facing behaviour.

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
  unless the index is created. Stale hourly quota buckets accumulate
  without bound while the job is broken (the 48h cutoff is not a retention
  guarantee — see C2; even healthy, buckets live ~48h to just under 72h),
  and the chat-message side is UNKNOWN: the chat deletes are enqueued
  before the throw, and BulkWriter sends full batches as they enqueue, so
  `writer.close()` never being reached does NOT prove they never flushed
  (see C9) — whether stale chat messages accumulated, and how many, is
  unknown until logs/count evidence exists. The first resumed run clears
  the accumulated `aiUsage` backlog at once (see §2, "First resumed
  run"); the chat side of that run is likewise UNKNOWN.
- **Proposed change (this branch, patch only — NOT applied):** add a
  `fieldOverrides` entry for `aiUsage` / `bucket_start` to
  `firebase/firestore.indexes.json` (see §4). **Cost: conditional — see §2;
  no confirmed ₹0 figure (pending P1/P2).**
  Applying it later is the narrow console Add Exemption route only (one
  single-field exemption, §4). A
  whole-file `firebase deploy --only firestore:indexes` is NOT the route
  for this change (see §4). It is an index deploy, not a rules deploy, and
  does not touch the rules HOLD. No TTL, no manual cleanup run.

### F2 — App Check: not configured in code; enforcement state is console-only

- **Fact:** a repo-wide grep for `appCheck` / `AppCheck` /
  `initializeAppCheck` / `ReCaptcha` across `src/`, `firebase/`,
  `capacitor.config.ts` returns **nothing**. `AGENTS.md` confirms: "App
  Check is off". So no App Check provider (Play Integrity / reCAPTCHA v3)
  is wired into the web or native app.
- **Proposed change:** none now. **Rollout timing is OPEN — pending explicit
  owner confirmation; do NOT enforce.** The previous version of this report
  cited a standing user decision (2026-11-06) to turn App Check ON + enforce
  after Play Store publish, but no approval record or permission evidence
  for that rollout was found in the repo (see C4 above), so this report does
  not treat it as an approved decision. When the owner confirms timing and
  scope: add Play Integrity (Android) + reCAPTCHA v3 (web) in
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
  threw mid-run, before `writer.close()`: the `aiUsage` deletes were never
  enqueued at all, and the chat deletes enqueued earlier in the run have
  UNKNOWN completion — `close()` never being reached does not prove they
  never flushed (BulkWriter sends full batches as they enqueue; see C9).
  The only trace was the Cloud Scheduler "Failed" status + 2 log lines
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

**Live ↔ repo reconciliation (proof note, console 2026-11-22 ~13:54 IST):**
live shows 8 manual composite indexes + 4 single-field exemptions, while
the repo file lists 11 indexes + 1 field override. The two cover the same
ground — every repo index exists live:

| Repo entry | Live form |
|---|---|
| #1 transactions type ASC, transaction_date DESC (COLLECTION) | Manual composite `CICAgOjXh4EK` |
| #2 transactions transaction_date ASC, created_at DESC (COLLECTION) | Manual composite `CICAgJiUpoMK` |
| #3 transactions transaction_date ASC (COLLECTION_GROUP) | Single-field exemption `transactions / transaction_date` (CG Ascending) |
| #4 reminders is_completed ASC, notify_at ASC (CG) | Manual composite `CICAgOi3kJAK` |
| #5 debts is_active ASC, notify_at ASC (CG) | Manual composite `CICAgJiUpoMJ` |
| #6 goals is_completed ASC, notify_at ASC (CG) | Manual composite `CICAgJim14AK` |
| #7 car_checks is_completed ASC, notify_at ASC (CG) | Manual composite `CICAgJjF9oIK` |
| #8 car_documents notify_at ASC (CG) | Single-field exemption `car_documents / notify_at` (CG Ascending) |
| #9 recurring_expenses is_active ASC, notify_at ASC (CG) | Manual composite `CICAgJj7z4EK` |
| #10 chat_messages created_at ASC (CG) | Single-field exemption `chat_messages / created_at` (CG Ascending) |
| #11 announcements is_active ASC, created_at DESC (COLLECTION) | Manual composite `CICAgJiUsZIK` |
| fieldOverride reminders.notify_at (4 entries) | Single-field exemption `reminders / notify_at` (CG Ascending) |
| fieldOverride aiUsage.bucket_start (NEW, this branch) | **Missing live — this is the gap** |

**To apply later (after cost/effects approval — NOT done here) — one route
(console labels/preview NOT yet verified; see C10):**

- **Narrow route (the route for this one-field change — console
  labels/preview NOT yet verified; see C10):** Firebase console →
  Firestore → Indexes → **Automatic** tab → **Add Exemption**, Collection
  ID `aiUsage`, Field path `bucket_start`, COLLECTION_GROUP Ascending,
  preserving existing settings (the collection-scope Ascending /
  Descending / array-contains entries stay as in the repo
  `fieldOverrides` entry). Adds exactly this one single-field exemption
  and leaves every existing setting untouched — the preservation claim
  rests on the reconciliation table above (live holds 8 manual composite
  indexes, all Enabled, + 4 single-field exemptions) and on the exemption
  mechanism (an exemption overrides automatic settings for that field
  only); the console's own labels/preview for this path are NOT yet
  verified — that needs the read-only browser-task proof (C10). #3, #8
  and #10 stay single-field exemptions and are NOT converted to
  composites. No code change, no deploy, no TTL, no manual cleanup run.
  This is NOT the Manual-tab composite "Add Index" / "Create Index"
  route and NOT the whole-file deploy below — three separate routes; only
  Add Exemption is the route here.
- **Do NOT use the whole-file route for this change:**
  `firebase deploy --only firestore:indexes` from `firebase/` (index
  deploy only; does not touch rules) deploys the ENTIRE file — all 11
  indexes + both fieldOverrides — it is NOT a one-field-only change. It
  also re-asserts the three entries live currently covers only via
  single-field exemptions (#3, #8, #10), adding composite index entries
  for them — a representation change to existing settings (same query
  coverage, different console form). It is not the route for adding this
  one index.

The next `cleanupTransactions` run (03:00 IST) should then
succeed — verify from the Scheduler job status + Functions logs, not from
the deploy output alone.

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
| P8 | Firestore edition (Standard vs Enterprise) + database location for database `(default)` — both UNKNOWN until checked | Firebase console → Firestore → Data (database details), or `gcloud firestore databases describe --database='(default)' --project=driver-saathi-app` (`locationId` + `databaseEdition`) |
| P9 | Supabase project `qtqgwqefuzylyyqxswwi` — live/paused/deleted? plan? (F4 decision input) | Supabase dashboard |
| P10 | After the index is applied (future): index status Enabled + `cleanupTransactions` 03:00 run Success | Firebase console → Firestore → Indexes; Cloud Scheduler + Functions logs |

---

## 6. Proposed changes + costs (summary)

| # | Proposed change | Cost | Status |
|---|---|---|---|
| 1 | Add `aiUsage`/`bucket_start` COLLECTION_GROUP ASC index (fieldOverrides patch in this branch) | Conditional — see §2 (no confirmed figure; pending P1/P2) | **Patch ready, NOT applied** — needs cost/effects approval |
| 2 | Harden `cleanupTransactions` (per-query try/catch + log + retryCount, F6) | $0 | Proposed for a later bundle — not in this branch |
| 3 | Harden `earningsNudge` send (per-batch error logging, F6) | $0 | Proposed for a later bundle — not in this branch |
| 4 | Restrict web API key in console (APIs + referrers, F3) | $0 | Proposed, console-only — verify on installed app after |
| 5 | App Check on + enforce (F2) | $0 | OPEN — pending explicit owner confirmation; do NOT enforce |
| 6 | Decide Supabase project fate after Firebase cutover proven (F4) | $0 if free tier | User decision — not now |
| 7 | Fix stale `firebase/README.md` status + workflow "Gemini" comment (F4/F8) | $0 | Docs-only, later pass |

**Nothing in this branch is applied live. Nothing is merged. No schedule,
flag, secret, rule, or console setting is changed by this bundle.**
