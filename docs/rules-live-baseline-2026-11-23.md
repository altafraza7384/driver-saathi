# Firestore rules — live baseline evidence (2026-11-23)

> **Docs only. Nothing in this branch is deployed, applied, or merged into
> any live system. No rules change, no index, no code change.**
> This branch exists because the live-rules evidence previously lived only in
> the audit folder and WhatsApp attachments, which a remote reviewer cannot
> see. It publishes the evidence here, in the repo, so it can be reviewed.
> Source of the facts below:
> `muse-rules-live-vs-proposed-proof-2026-11-22.md` (audit folder, corrected
> 2026-11-23 with the correct baseline). All hashes, blobs, line counts and
> diff counts in this note were re-verified from committed source at
> `origin/main` `579d353` before this branch was pushed.

## Files in this branch

- `docs/rules-live-2026-11-23.txt` — the COMPLETE deployed rules text,
  **285 lines**, sha256
  `46249423df80708d37c499146b6a2589d1131771a0e22ed9d8a72a825d271b3c`.
  Transcribed from the Firebase console editor view of the starred version
  (see below). The hash is of the transcription, not a downloaded file —
  re-verify from a downloaded/CLI copy at deploy time.
- `docs/rules-live-vs-proposed-diff-2026-11-23.txt` — the unified diff,
  live → proposed: **+156/−63 raw, +127/−34 substantive** (ignoring
  whitespace). Direction note: the file as stored is diffed proposed → live
  (its headers read `--- /tmp/proposed-rules.txt` /
  `+++ live-firestore-rules-2026-11-23.txt`, +63/−156 in that direction),
  which is exactly the reverse of live → proposed +156/−63. Arithmetic
  closes both ways: live 285 + 156 − 63 = proposed 378.
- `docs/rules-live-baseline-2026-11-23.md` — this note.

## Current deployed version

- **Deployed (starred): Nov 8, 2026, 8:15 PM** — pre-#26 rules.
- Full version history (22 entries, newest first):
  1. Nov 8, 2026 • 8:15 PM (starred)
  2. Nov 5, 2026 • 2:30 PM
  3. Nov 5, 2026 • 8:11 AM
  4. Nov 4, 2026 • 11:26 AM
  5. Nov 4, 2026 • 11:16 AM
  6. Nov 4, 2026 • 2:31 AM
  7. Nov 3, 2026 • 2:35 PM
  8. Nov 2, 2026 • 3:28 PM
  9. Oct 31, 2026 • 5:42 PM
  10. Oct 26, 2026 • 12:32 AM
  11. Oct 25, 2026 • 9:52 PM
  12. Oct 25, 2026 • 9:40 PM
  13. Oct 25, 2026 • 8:55 PM
  14. Oct 24, 2026 • 3:41 PM
  15. Oct 24, 2026 • 3:32 PM
  16. Oct 24, 2026 • 9:14 AM
  17. Oct 22, 2026 • 9:42 PM
  18. Oct 22, 2026 • 8:19 PM
  19. Oct 22, 2026 • 2:55 PM
  20. Oct 22, 2026 • 12:25 PM
  21. Oct 20, 2026 • 1:30 PM
  22. Oct 20, 2026 • 1:15 PM
- Console: `https://console.firebase.google.com/project/driver-saathi-app/firestore/databases/-default-/security/rules`
  (read-only check, signed in as Altaf Ansari — altafraza7384@gmail.com;
  nothing saved, published, or created; the Publish button was not used).

## After-reload proof (same version, same text)

Re-confirmed 2026-11-23 ~11:00 IST. Three passes agreed on the same text:

1. Fresh-load full transcription of the starred Nov 8, 8:15 PM version
   (285 lines; editor gutter: 285 code lines, line 286 empty).
2. Targeted 5-block re-read **after reload and re-clicking ONLY the starred
   entry** — same version, same text.
3. Block-by-block targeted re-reads verifying the transcription section by
   section: `insurance_leads` `{id}` with `allow delete: if isAdmin();`;
   `marketplace_categories` + `marketplace_posts` (no `marketplace_listings`
   anywhere); ONLY `config/subscription_nudges` (no per-user block);
   announcements read with `notBlocked()`; `ownedCollections` 16 entries;
   mechanics update line; SOS accept branch; helpers; complete 22-entry
   history — all match.

**No screenshot file exists.** The browser task returns no file paths, so no
screenshot can be attached. The after-reload proof is the verbatim text
re-reads above, not an image. Do not treat this note as image evidence.

## First-load stale-ruleset anomaly (do not hash or diff a first load)

The very first editor load showed a DIFFERENT "// Global helpers" ruleset
(`ride_requests`, `aiUsage` blocks) matching no history entry checked. It is
a stale draft/cache on first load — never hash or diff it. The Nov 22 proof
hit the same anomaly and saved the wrong text because of it (see
"Withdrawn baseline" below). Always reload and re-click ONLY the starred
entry, then read again.

## Refuted screenshot-task claims

A separate screenshot task claimed helper names `isSignedIn`/`isDriver` and
history entries Nov 8, 8:01/7:46 PM. A targeted re-read REFUTED both: the
helpers are `signedIn`/`isOwner`/`isAdmin`, and there are no 8:01/7:46
entries. That task had read a stale first-load state, and its screenshots
carry no file paths so none can be attached.

## Two transcription errors caught and fixed

Two errors in the first full read were caught by the targeted re-reads and
fixed in the saved live text:

- `held_until` is **NOT** in the live mechanics update line (removed).
- `mechanicPhone` **IS** in the live SOS accept line's `hasOnly` list
  (added).

Both lines now match the proposed file exactly, so the two "small
expansions" previously flagged do not exist. The live mechanics update line
is identical to proposed, and the SOS accept branch is identical in live
and proposed.

## Proposed file (what the diff compares against)

- Repo `main` `firebase/firestore.rules` at `579d353`, git blob
  **`1e899c2`** (full `1e899c23b4be8daa5cec559729d8d800a847167e`), sha256
  `3047c92f7be57541f698a57130a013c11c02ba3f1c23ff3edfd4192cfc41c754`,
  **378 lines**. This is the reviewed rules file from PR #26 (merged
  2026-11-22, main `1dcdf39` → `579d353`); no rules change has landed on
  main since. (Caution for future checks: a stale local `main` ref in one
  worktree points at `aa7e784`, whose rules file is the older 291-line
  version — always verify against `origin/main` `579d353`, never a local
  `main` ref.)

## Withdrawn baseline (do NOT use)

- `live-firestore-rules-2026-11-22.txt` (273 lines, sha256 `17016bb3…`) is an
  OLDER ruleset, not the starred Nov 8 version — it has a compact
  single-line `insurance_leads/{leadId}` block with `allow delete: if
  false`, a per-user `subscription_nudges/{uid}` block, and a
  `marketplace_listings/*/offers/*` section, none of which exist in the
  deployed rules. Its diff (+193/−88) and behaviour-change inventory are
  WITHDRAWN. It is retained in the audit folder for audit only.
- The Nov 22 note's line-count explanation (286 gutter vs 273 logical,
  "wrapping") was wrong — the gap was a different file, not wrapping.

## What the diff shows (live → proposed, grouped)

Nearly everything is owner-approved (PR #26 merge 2026-11-22 + owner
decision 2026-11-21 + reviewed PRs #23/#25) — per-item evidence in the
table below.

1. **New text-hardening helpers** — `textFieldOk`, `profileTextOk` (full_name
   100, email 320, phone 20, vehicle_type 50, vehicle_number 20,
   license_number 50, preferred_language 20), `leadTextOk` (name 100, phone
   20, vehicle_number 20, vehicle_model 100, vehicle_year 10, city 100,
   policy_expiry 30), plus `changedTextOk`/`profileTextUpdateOk`/
   `leadTextUpdateOk` for updates. Present fields must be real strings
   within the caps; absent/null stays allowed.
2. **Email-verification gate** — new `isUnverifiedEmailUser()` (signed in +
   `sign_in_provider == 'password'` + `email_verified != true`) and
   `notUnverified()`. Applied to: own profile read/create/update, all owned
   subcollections, roles read, insurance-lead create/read, SOS create/read,
   SOS details create/read. Google/phone sign-ins are exempt; admins
   unaffected. Plus the narrow SOS-cancel closure: an unverified owner may
   CANCEL their own existing SOS request (status → cancelled, only `status`
   + `updated_at` may change) and nothing else.
3. **`ownedCollections` 16 → 19** — adds `habits`, `habit_logs`,
   `routine_settings`. This is the fix for the verified permission-denied
   reads on those collections.
4. **`roles` read** gains `notUnverified()`.
5. **`subscription_plans`** — price check extracted to `validPlanPrice()`;
   create/update gain a `deleting` guard; **delete changes from
   `if isAdmin()` to `if false`** (only the cancellation-first Admin SDK
   callable may remove plans). **This is the ONLY live permission the
   proposed file removes.** Its approval status is the open question Q2.
6. **Offers, announcements, config, marketplace — NO CHANGE.** Live already
   has announcements read with `notBlocked()`, `config/subscription_nudges`
   + `config/{docId}`, and `marketplace_categories` + `marketplace_posts`.
   There is no per-user `subscription_nudges/{uid}` block and no
   `marketplace_listings/*/offers/*` section in the deployed rules.
7. **`insurance_leads`** — create gains `notUnverified()` + `leadTextOk()`;
   read gains `notUnverified()` for the owner; update gains
   `leadTextUpdateOk()` (admin-only with diff-check unchanged). **Delete is
   `if isAdmin()` in BOTH live and proposed.**
8. **`sos_requests`** — create/read gain `notUnverified()`; driver
   cancel/complete branch gains the unverified cancel-only closure;
   comments/indentation rewritten. The read gate applies to the **driver
   branch only** — the pending-list (phone-verified mechanic) and
   assigned-mechanic branches are unchanged and ungated. The accept branch
   is IDENTICAL in live and proposed.
9. **`sos_request_details`** — create gains `notUnverified()` plus a
   parent-request existence + ownership check (no orphaned or forged details
   docs — the details doc carries exact coords + phone); read gains
   `notUnverified()` for the driver.
10. **`mechanics` — NO CHANGE.** The live update line matches the proposed
    file exactly.
11. **Unchanged** — `sos_push_log`, the `/{document=**}` catch-all deny,
    block/`isAdmin` helpers, `isValidApproxLat/Lng`,
    `mechanicServesCategory`.

## Per-item approval evidence (every difference traced to its introducing commit)

Each proposed change was traced to its introducing commit in the repo
history (`git log -S` / `git show` on `firebase/firestore.rules` at main
`579d353`):

| # | Proposed change | Introduced by | Approval evidence |
|---|---|---|---|
| 1 | Text-hardening helpers (`textFieldOk`/`profileTextOk`/`leadTextOk` + update variants) | `acda46f` (2026-11-22, "release: combined PRs #19-25 (firestore.rules)") | Merged via PR #26 (merge `1dcdf39`) with the user's approval 2026-11-22 11:43 IST, after the v5 review which described the hardening. Audit follow-up #23. |
| 2 | Email-verification gate (`isUnverifiedEmailUser`/`notUnverified` + all applications incl. SOS cancel-only closure) | `acda46f` (same combined release) | Owner decision 2026-11-21 (gate: unverified password users cannot read/write own data); merged via PR #26 with the user's 11:43 IST approval after the v5 review. |
| 3 | `ownedCollections` 16 → 19 (habits/habit_logs/routine_settings) | `acda46f` (same combined release) | "Roz ka Routine" feature, one of the 4 agreed features in PRs #19–25; merged via PR #26 with the user's approval. This is the fix for the verified permission-denied reads. |
| 4 | `roles` read gains `notUnverified()` | `acda46f` | Part of the gate (item 2) — same evidence. |
| 5 | `subscription_plans`: `validPlanPrice()` + `deleting` guard; **delete `if isAdmin()` → `if false`** | `db45208` (2026-11-09, "fix: prevent client bypass of cancellation-first plan deletion", author altafraza7384) | **DECIDED 2026-11-24 13:05 IST (owner): subscription_plans client delete stays `false` (Q2, below).** The `deleteSubscriptionPlan` callable (cancellation-first: sets `deleting`, cancels Razorpay mandates, clears plan ids, deletes offers, then deletes via Admin SDK) is user-requested (Admin plan DELETE shipped 2026-10-25) and the admin page uses only the callable. Merged via PR #26. **Policy approval ONLY — NOT approval for merge/deploy or rules/index apply.** |
| 6 | `insurance_leads`: create/read gain `notUnverified()` + `leadTextOk()`/`leadTextUpdateOk()`; delete stays `if isAdmin()` in BOTH | `acda46f` | Gate (item 2) + hardening (item 1) — same evidence. Delete unchanged. |
| 7 | `sos_requests`: gate + cancel-only closure | `acda46f` | Gate (item 2) — same evidence. |
| 8 | `sos_request_details`: parent-request existence + ownership check on create, gate on create/read | `acda46f` (combined release; the parent check is PR #25 hardening) | Merged via PR #26 with the user's approval after the v5 review. |
| 9 | Formatting only (indentation, line-wrapping, `['monthly','yearly']` → `['monthly', 'yearly']`, blank lines) | Console reformat on publish | No behaviour change. |

**Bottom line of the reconciliation:** of the substantive differences, every
one is covered by the PR #26 merge approval and/or the 2026-11-21 gate
decision, including item 5's delete line, which was Q2 — now DECIDED
2026-11-24 (delete stays `false`; see Q2 below). The proposed file removes
exactly ONE live permission (plan delete, admin) and otherwise only adds
owner-approved restrictions.

## Preservation patch v2 — DEAD (Q2 decided 2026-11-24; reviewable only — NOT applied anywhere)

- `rules-preservation-0001v2-restore-plan-delete.patch` (audit folder) —
  base: main `579d353`, proposed blob `1e899c2` (378 lines) → preserved blob
  **`72f3c4d5`** (full `72f3c4d5ff089c7d5356959a340f84f21f849034`), 380
  lines, sha256
  `5ff9e6dff24676daec8a3530e522ebc2245ae417fa7ef0486792a9297d9d1e3b`.
  Exactly ONE change: `subscription_plans` `allow delete: if false;` →
  `if isAdmin();` (with a comment pointing at Q2). Verified: the patch
  applies cleanly onto main `579d353` in a scratch clone; only the intended
  file changes; resulting blob/hash/lines all match.
  **DEAD — do NOT apply:** Q2 was decided 2026-11-24 13:05 IST (owner):
  subscription_plans client delete stays `false`. The patch is retained in
  the audit folder for audit only; it was used in round 6 only as the
  failing-first control file (see Q2 below), never applied to any branch.
- `rules-preservation-0002v2-plan-delete-tests.patch` (audit folder) — 2
  targeted rules tests in `firebase/functions/test/rules.test.ts` (248 →
  265 lines, 44 → 46 `it()`): admin CAN delete a plan (FAILS against the
  proposed file, PASSES against the preserved file), non-admin CANNOT delete
  a plan (passes against both).
  **DEAD — do NOT add:** they assert the opposite of the decided Q2 value.
- WITHDRAWN (wrong baseline, do not use):
  `rules-preservation-0001-restore-live-permissions.patch` (preserved blob
  `10d0930`) and `rules-preservation-0002-preserved-permissions-tests.patch`
  (15 tests). They would have set insurance-lead delete to `false` (live
  allows admin delete), added a per-user nudge block and a
  marketplace-offers section that do not exist live, and removed
  `notBlocked()` from announcements read (live has it). Retained in the
  audit folder for audit only.
- Q1 and Q3 from the first round-3 preservation section are withdrawn as
  moot (false premises: live insurance-lead delete is already admin-allowed,
  and there are no per-user-nudge or marketplace-offer paths in the deployed
  rules).

## Q2 — DECIDED 2026-11-24 13:05 IST (subscription_plans client delete stays `false`)

**Q2 — Plan delete vs cancellation-first deletion.** Requirement in
conflict: cancellation-first plan deletion — the `deleteSubscriptionPlan`
callable (`firebase/functions/src/razorpay.ts:577`) sets `deleting: true`,
cancels every live Razorpay mandate, clears `subscription_plan_id` from
users, deletes offers, then deletes the plan via Admin SDK; the admin page
uses only this callable (`src/pages/admin/AdminPlansPage.tsx:111`, no client
delete). Permission: `subscription_plans` delete — live admin-allowed,
proposed `false`. Preservation (v2) restores the live admin delete, so a
direct admin delete via rules remains possible and would bypass mandate
cancellation (subscribers keep a plan id pointing at a deleted plan).
**Question: keep direct admin delete (live), or close the bypass by flipping
this one line back to `false` (proposed)?**

**DECIDED by the owner 2026-11-24 13:05 IST: subscription_plans client
delete stays `false` (the proposed value).** Direct client delete is denied
for admins and non-admins alike; the normal Admin Plans delete button
continues through the cancellation-first `deleteSubscriptionPlan` callable.
Preservation v2 (patch + its 2 tests) is DEAD — do not apply it.

**This is a POLICY approval ONLY — NOT approval for merge/deploy or
rules/index apply.** The deployable file, if deployment is ever approved,
is the proposed file as-is (blob `1e899c2`, 378 lines).

**Round 6 (2026-11-24) pin:** 1 new rules test records the decision —
`admin CANNOT directly delete a plan (Q2 decided: delete stays false)` in
`firebase/functions/test/rules.test.ts` (44 → 45 `it()`; branch
`review/rules-admin-delete-deny-test-2026-11-24`, local commit `4829d14`,
remote head `3f1d7e0`). It asserts admin client delete → denied AND
non-admin client delete → denied; the callable path is out of scope for
rules tests. Local failing-first could NOT be demonstrated: the emulator
fails at rule-load before any test executes (see Emulator result below),
so the test neither passed against the proposed file nor failed-assertion
against the preservation-v2 allowing file locally.

**Rules deployment remains HELD** — Q2 is answered, but this decision is a
policy approval only (no merge/deploy or rules/index approval), and a green
emulator run of the 45 rules tests is still not obtained (see below). The
auth prerequisite (signup → verify → Home) is satisfied; no re-signup is
pending. This proof is NOT a go-ahead for rules deployment.

## Emulator result — PENDING, NOT a pass

Do NOT describe the emulator run as passed. The Firestore emulator's
`:securityRules` PUT returns **503 UNAVAILABLE "io exception"** (thrown
inside the emulator itself) for the real rules file AND a trivial 6-line
file — with JDK 17 and JDK 21 (Temurin 21.0.13.1), with and without JVM
proxy props. `vitest run test/rules.test.ts` therefore fails at
`initializeTestEnvironment`/`loadFirestoreRules` with **all 45 tests
skipped**. The targeted emulator run (45 tests incl. the 1 admin-deny test;
the 2 preservation-v2 tests are dead with Q2) remains PENDING — it needs an
environment where the emulator's rules endpoint works (user's machine / CI).

Round-6 re-attempt 2026-11-24 (JDK 21 Temurin 21.0.13.1, emulator
v1.22.0, port 8085, emulator HTTP 200 on `/`): same failure, verbatim —
`Error: {"error":{"code":503,"message":"io exception","status":"UNAVAILABLE"}}`
at `loadFirestoreRules`, 45 tests skipped, exit 1 — attempted once against
the proposed file (blob `1e899c2`) and once against the preservation-v2
allowing file (blob `72f3c4d5`); both fail identically at rule-load, before
any test executes. Also verified the same day: no CI workflow runs the
rules tests — Production Checks (`bun run test`) runs only the root
`src/**` vitest suite, and no workflow runs
`firebase/functions` `test:rules` — so there is no CI green to report
either. What would give a real result: a workflow job running the emulator
rules suite, or a run on the user's machine / an environment where the
`:securityRules` endpoint works.

## Why the user's permission-denied reads happen

The verified non-admin account gets permission-denied on `habits`,
`habit_logs`, `routine_settings` reads because the **live**
`ownedCollections()` has only 16 entries — those three collections are
absent, so reads fall through to `match /{document=**} { allow read, write:
if false; }`. This is **expected under the current live rules** and is
exactly what the proposed rules fix (they add the three collections). The
account itself is fine: verified, password-provider, non-admin; signup +
email verification were done by the user, direct login and Home pass.
