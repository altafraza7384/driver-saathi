# Driver Saathi — Privacy Disclosures DRAFT

> **STATUS: DRAFT — NOT A COMPLIANCE CLAIM.**
> This document maps the data flows that actually exist in the code as of
> 2026-11-22 (base commit `579d353`). It is a working draft for the owner
> and, if needed, a lawyer to turn into a real privacy policy. It is **not**
> legal advice, **not** a compliance certificate, and **not** a claim that
> the app complies with the DPDP Act, IT Rules, or any other law.
> **Owner review and legal review are still pending.** Nothing in this
> draft may be published as the app's privacy policy without that review.
>
> Method: read the code (`src/`, `firebase/functions/src/`,
> `firebase/firestore.rules`, the in-app policy at
> `src/pages/PrivacyPolicyPage.tsx`). Where a business or contact detail
> is not in the code, it is listed under **Open questions** — never
> invented. Where the in-app policy says something the code does not do,
> that is listed under **Gaps vs the in-app Privacy Policy**.
>
> Corrections 2026-11-22 (PR #30, branch
> `review/web-security-privacy-2026-11-22`): the first version of this
> draft wrongly said per-user finance/health rows are owner-only, stated
> the Firestore region as `asia-south1`, presented the logout cache
> clear as already live, and described speech as on-device-only. All
> four are corrected below against `firebase/firestore.rules`,
> `src/lib/useDrivingMode.ts` / `src/lib/nativeSpeech.ts`, and the PR
> status (the cache fix is proposed, not merged). Nothing else in the
> draft was re-verified in that pass.

## 1. Who we are (as far as the code says)

- App: **Driver Saathi** — Hindi-first money + vehicle companion for
  drivers in India (earnings/expenses, debts/EMIs, goals, reminders,
  health logs, notes, Car SOS + Mechanic Saathi).
- The in-app policy names the "Company" as **"Driver-saathi"** and the
  country as **Maharashtra, India**. No legal entity name, registered
  address, or company registration detail exists anywhere in the code.
  → Open questions Q1–Q2.
- Contact shown in-app (Support page + Privacy Policy):
  `razakhan.chino@gmail.com` and `+91 7718012850`. These are the only
  contact details in the code; whether they are the right grievance
  contact is an open question (Q3).

## 2. Data map — what is collected, where it lives, who can read it

All per-user data lives in Firestore (project `driver-saathi-app`;
the database region is **not stated anywhere in the repo** — do not
assume `asia-south1` from the Cloud Functions region; confirm it in
the Firebase console, Q12) under `users/{uid}` and per-user
subcollections. Per-user subcollections are readable (and deletable)
by the owner **and by admins** under the Firestore rules
(`firebase/firestore.rules:156` — `allow read, delete: if
((isOwner(uid) ...) || isAdmin())` over every collection in
`ownedCollections()`). Top-level collections are listed in
`src/integrations/firebase/adapter.ts` (`TOP_LEVEL_TABLES`).

| Data | What exactly (code) | Stored where | Who can read it |
|---|---|---|---|
| Account | Email, password hash (Firebase Auth, never in app code), display name, phone (optional, profile), email-verified flag, `trial_started_at` / `trial_ends_at`, `subscription_plan_id` | Firebase Auth + `users/{uid}` | Owner + admin (admin panel) |
| Finance | Transactions (amount, type income/expense, category, date, notes), debts (lender/name, principal, total_paid, interest rate, EMI), debt payments, budgets, savings goals, recurring expenses | `users/{uid}/transactions`, `debts`, `debt_payments`, `budgets`, `goals`, `recurring_expenses` (+ payments) | Owner + admin — the rules allow admins to read AND delete these rows (`firestore.rules:156`); the admin panel UI surfaces subscription status, but nothing in the rules prevents an admin reading finance rows |
| Health | Self-reported wellness only: sleep hours, glasses of water, breaks taken, steps — one row per day. No medical, BP, or clinical data is collected. | `users/{uid}/health_logs` | Owner + admin (same rule — `firestore.rules:156`) |
| Reminders / notes | Reminder text + notify date/time, notes text, car checks, car documents metadata | `users/{uid}/reminders`, `notes`, `car_checks`, `car_documents` | Owner + admin (same rule — `firestore.rules:156`) |
| Emergency contacts | Name + phone number, typed in by the user (not imported from the phone book — no phone-book code exists), `is_primary` flag | `users/{uid}/emergency_contacts` | Owner + admin (same rule); phone is sent by SMS/WhatsApp only when the user triggers SOS (see §5) |
| Location — SOS only | Exact GPS latitude/longitude at SOS time; approximate coords (~1.1 km rounding) + geohash-6 | Exact: `sos_request_details/{id}` (driver + assigned mechanic only). Approx: `sos_requests/{id}` (visible to mechanics browsing requests — no phone, no exact location) | See §5 |
| Location — otherwise | **None.** Location is read only inside the SOS flows (`src/pages/CarSosPage.tsx`, `src/pages/SOSPage.tsx`). No background tracking, no trip tracking. | — | — |
| AI chats | Chat messages (user + assistant turns) | **Local only** — device localStorage, max 50 messages, pruned after 24 h (`src/lib/chatHistory.ts`). The server stores no chat history. | Only on that device; survives logout (see §8) |
| AI quota accounting | Per-user AI usage counters, time-bucketed (`aiUsage` collection, `bucket_start`) | Firestore `aiUsage` | Server functions; not shown to other users |
| Push tokens | FCM device token + endpoint, per user/device | `users/{uid}/push_subscriptions` | Owner + admin (same rule — `firestore.rules:156`); server functions use the token to send that user's pushes |
| Insurance leads | Name + contact details the user types on `/insurance`, only with explicit consent (`consent == true` required by rules); lead status + commission (admin-only fields) | `insurance_leads` (top-level, owner + admin read) | Owner + admin; forwarded to the insurance partner manually in Phase 1 (see §7) |
| Marketplace | Posts the user creates (title, description, price, category, photos if any) | `marketplace_posts` (+ `marketplace_categories`) | Public to signed-in users by design |
| Announcements | Admin-written title/message, audience, active flag | `announcements` | All signed-in users (content is public to them by design) |
| SOS requests | Vehicle/problem category, approximate location (above), status, assigned mechanic | `sos_requests` / `sos_request_details` | See §5 |

## 3. Account & authentication

- Firebase Auth (Email/Password + Google). Phone OTP login is **not**
  built for drivers (Google + email only, by owner decision).
- Password signup is blocked until the email is verified (verification
  HARD mode); Google users and admin-created accounts are exempt.
  (`firebase/functions` + adapter `ensureVerifiedProfileForCurrentUser`.)
- No passwords, OTPs, or keys are stored in app code. Firebase client
  keys in the repo are publishable identifiers, not secrets.
- Account deletion exists server-side: the `deleteAccount` callable
  (`firebase/functions/src/index.ts`) deletes the user's Firestore data
  (`deleteUserData`) and then the Auth user. Admin can also delete a user
  (`adminDeleteUser`) with a DELETE-word confirmation.
- Session: Firebase Auth session persists on the device ("keep user
  logged in indefinitely" — `src/hooks/useAuth.tsx`).

## 4. Finance & health — no sharing

- Finance and health rows are never sent to any third party except as
  described in §6 (AI) and §7 (payments/insurance). They are not used
  for ads. They are not visible to mechanics or other drivers. They
  **are** visible to admins: the Firestore rules allow admins to read
  and delete every per-user subcollection, including finance and health
  rows (`firebase/firestore.rules:156`). The admin panel UI currently
  surfaces subscription status rather than finance rows, but that is a
  UI choice, not a rules boundary — the policy must disclose admin
  access as permitted, not as impossible. (No admin permission is
  changed by this draft; the rules are stated as they are.)
- The app works offline: Firestore keeps a persistent local (IndexedDB)
  cache of the user's own data on the device. A logout cache clear is
  **proposed, not live** (PR #30, `review/web-security-privacy-2026-11-22`,
  unmerged as of 2026-11-22): it would clear that cache on logout only
  when two things are both proven — the departing user's own offline
  queue is clean, AND no earlier signed-in user has unresolved
  preserved writes recorded in the preserved-writes ledger
  (`src/integrations/firebase/logoutCache.ts` + `signOutFlow.ts` +
  `preservedWrites.ts`). A clean check of the departing user's queue
  alone does NOT prove a whole-cache clear safe, because
  `waitForPendingWrites` only sees the active identity's queue. The
  safety claim is conditional on that proven scope only: the ledger
  records only identities whose logout went through this flow, so a
  session that ends without that logout path (e.g. a token revoked
  while offline) leaves no record, and a later clear cannot be proven
  safe for that identity's writes. Within the proven scope, pending
  offline writes are always preserved, never deleted. Until that PR
  merges and deploys, logout does **not** clear the offline cache.

## 5. Location & SOS — the split that matters

- When the driver taps SOS, the app reads one GPS fix and splits it
  (`src/lib/carSos.ts`):
  - **Public part** — `sos_requests/{id}`: approximate latitude/longitude
    (rounded to ~1.1 km), geohash-6, problem category, status. No phone
    number, no exact location. Mechanics browsing requests see only this.
  - **Private part** — `sos_request_details/{id}`: exact latitude/longitude
    + driver phone number. Readable only by the driver or the assigned
    mechanic (rules).
- SOS alerts are handed off, not sent by the app, and delivery is not
  guaranteed or confirmed: tapping SOS opens the device's SMS composer
  (`sms:` link, all emergency contacts) and the WhatsApp share opens a
  `wa.me` link for the first contact (`src/pages/SOSPage.tsx`) — the
  user presses send in the messaging app, and the app records no
  delivery confirmation. No SOS dispatch guarantee is made. The
  contacts' numbers are not uploaded anywhere for this — they are read
  from the driver's own `emergency_contacts` rows.
- Mechanics: `mechanics` collection (profile, services, online status,
  phone-verified flag). Admin verifies a mechanic's phone number
  manually; there is no OTP.
- Location permission is requested only when SOS is used. No location
  history is kept: each SOS request carries only that request's fix.

## 6. AI processing — Groq (the only AI sub-processor)

- AI runs server-side in Cloud Functions (`firebase/functions/src/ai.ts`,
  region `asia-south1`), not on the device and not directly from the app.
  The app calls the `chat` and `financeAi` callables; the function then
  calls **Groq** (`https://api.groq.com/openai/v1/chat/completions`,
  model `openai/gpt-oss-120b`) with the server-held `GROQ_API_KEY` secret.
- What is sent to Groq on each AI call:
  - `chat`: the user's messages in that conversation (max 20 messages,
    max 20,000 characters total) + a system prompt. No finance figures.
  - `financeAi`: the same messages **plus** a system prompt containing
    this month's income / expense / net totals, active debts (name,
    remaining amount, interest rate) and goals (title, saved/target).
    Only month-to-date aggregates and the debt/goal summaries above —
    never full transaction rows, names of payees, or notes.
- What Groq does **not** get: the user's name, email, phone, exact
  location, health logs, or emergency contacts. (The messages themselves
  could contain anything the user types — that is the user's own input.)
- Groq is a US-based processor; the app's privacy policy must disclose
  this cross-border transfer. Whether a data-processing agreement (DPA)
  exists with Groq is **unknown from the code** → open question Q6.
- AI use is metered: 7-day free trial from first AI use, then hourly
  caps (see the trial logic in `firebase/functions/src/shared.ts`).
  Quota counters live in `aiUsage`; a scheduled cleanup function prunes
  old buckets.
- AI functions are deployed and live; the app fails gracefully when
  they are unavailable.

## 7. Payments & insurance — the two money hand-offs

- **Payments — Razorpay.** Subscriptions are sold through Razorpay
  (`src/components/SubscriptionPlansCard.tsx`,
  `firebase/functions/src/razorpay.ts` + `webhook.ts`).
  - The app loads `https://checkout.razorpay.com/v1/checkout.js` and
    opens Razorpay Checkout. Prefill sent to Razorpay: the user's
    **email and phone number** (from profile/Auth). The plan name and
    subscription id come from the server callable.
  - Card / UPI / bank details are entered **inside Razorpay Checkout**
    and never touch Driver Saathi's servers or the app's code.
  - Flow: ₹1 mandate authorisation at signup, plan amount auto-debited
    only after the 7-day trial. The webhook flips the plan only when
    Razorpay reports the subscription `active`.
  - Razorpay is the payment processor; its own privacy terms apply to
    the payment data. The app's policy must name Razorpay → Q7.
- **Insurance leads — partner not yet named.** `/insurance` collects the
  user's contact details **once, with explicit consent**, for a quote
  from a "licensed insurance partner". Driver Saathi does **not** sell
  insurance or collect premiums. Phase 1 forwarding is manual (admin
  sends the lead to the partner). The partner's name and licence number
  are **not in the code** and must replace the generic wording before
  going live with a real partner → open question Q8.

## 8. On-device-only data (never leaves the phone)

- **AI chat history**: localStorage only, 24 h prune, 50-message cap.
  It is **not** cleared on logout — a shared-device user can read the
  previous user's AI chats for up to 24 h. This is a known gap; clearing
  it on logout is future work, not done in this bundle.
- **Routine reminders**: local notifications scheduled on the device
  (`@capacitor/local-notifications`); no server copy.
- **Firestore offline cache**: the user's own Firestore data cached in
  IndexedDB for offline use; a logout clear is proposed, not live (see
  §4 — PR #30, unmerged).
- **Speech/driving mode**: microphone input is recognised for voice
  commands, but neither path is evidenced as on-device-only, so no such
  claim is made here. On the web the app uses the browser Web Speech API
  (`src/lib/useDrivingMode.ts`); in the native app it uses the Capacitor
  speech-recognition plugin, i.e. Android's recogniser
  (`src/lib/nativeSpeech.ts`). The browser path may send audio to the
  browser vendor's speech service. Only the text the user sends goes to
  Groq (see §6); no audio is sent to Groq by the code.

## 9. Notifications, analytics, ads

- **Push**: FCM tokens in `push_subscriptions`. Server functions send
  reminder pushes at the notify time the user set, earnings nudges
  (opt-in, 15:00 + 21:30), trial-expiry nudges, announcement pushes
  (only when created Active), and SOS request pushes to mechanics.
  There is **no** automatic 1-day-advance push — a day-before notice
  needs the notify date itself set a day early.
- **Analytics**: Firebase Analytics, native app only, screen names and
  generic event names only — no user id, phone, email, or amounts
  (`src/lib/analytics.ts`). Crashlytics was removed (2026-11-07).
- **Ads**: AdMob native ads (Assistant / Finance AI when the chat is
  empty; SOS page). AdMob is Google's ad SDK and collects advertising
  identifiers by its own terms; the exact data AdMob collects must be
  confirmed in the AdMob console, not assumed here → Q9.

## 10. Retention — what the code actually does

There is **no server-side retention / auto-deletion job for user data**
in the code. What exists:

- User data is kept until the user deletes the account (see §3) or an
  admin deletes it. No expiry is applied to transactions, debts,
  health logs, notes, or reminders.
- AI chat history: 24 h, on-device only (§8).
- AI quota counters (`aiUsage`): pruned by the scheduled
  `cleanupTransactions` function (old buckets deleted).
- Firestore offline cache: a logout clear is proposed, not live (§4).
- **The in-app policy's retention numbers are not implemented** — see
  the gaps below.

## 11. Gaps vs the in-app Privacy Policy (`src/pages/PrivacyPolicyPage.tsx`)

The in-app policy (last updated April 12, 2026) is a generic template.
These statements do not match the code and must be fixed before the
policy is relied on:

1. **"Address, State, Province, ZIP/Postal code, City"** — the app
   collects no postal address. Profile = name, email, phone (optional).
2. **"Information from your Device's phone book"** — no code reads the
   phone book. Emergency contacts are typed in manually.
3. **"Pictures and information from your Device's camera and photo
   library"** — no code in `src/` opens the camera or photo library.
4. **Retention: "User Accounts … up to 24 months after closure;
   Chat transcripts: up to 24 months"** — no 24-month retention is
   implemented server-side; chat transcripts are local-only and gone
   after 24 **hours**. The numbers appear invented.
5. **"Our Service does not address anyone under the age of 16"** —
   the age figure is wrong for India (18+ is the relevant threshold;
   flagged before, fix parked). No age check is enforced in signup
   today (6-character password minimum only).
6. **"Company — Driver-saathi"** with no legal entity, address, or
   grievance officer named. The DPDP Act requires a grievance officer's
   name + contact for a data fiduciary of this size — none is named.
7. **"Your information may be transferred … outside of Your
   jurisdiction. We ensure appropriate safeguards are in place."** —
   no safeguard is named. Actual transfers: Groq (US, §6), Razorpay
   (payment data, §7), Firebase/Google (hosting + data + Cloud
   Functions in `asia-south1` — the Functions region only; the
   Firestore database region is not stated in the repo, Q12).
8. **No mention** of Groq/AI processing, Razorpay, the SOS
   exact-vs-approximate location split, the offline cache, or the
   insurance-lead sharing — the four highest-risk disclosures.
9. **"You may update or delete Your information by signing in to Your
   Account"** — this part is true: Settings has a Delete Account flow
   (DELETE-word confirmation) that invokes the server-side
   `delete-account` callable. The retention numbers in point 4 are
   still unimplemented, so the deletion claim is fine but the
   retention claim is not.

## 12. Open questions (owner / legal to answer — nothing invented)

- **Q1.** Legal entity: what is the registered business / proprietor
  name behind "Driver Saathi"? (Needed for the policy's "Company".)
- **Q2.** Registered / business address (city, state, PIN).
- **Q3.** Grievance officer: name, email, phone — and confirm whether
  `razakhan.chino@gmail.com` / `+91 7718012850` (currently shown
  in-app) are the correct grievance contacts.
- **Q4.** Age threshold: confirm 18+ (not 16) and whether an age check
  is added at signup or the policy only states it.
- **Q5.** Retention decisions: how long is each category kept after
  account closure — or is "until deletion" the policy? (The 24-month
  figures in the current policy are unimplemented; decide real numbers.)
- **Q6.** Groq: is there a DPA / sub-processor agreement? Confirm the
  exact Groq data-processing terms to disclose (US transfer, model
  `openai/gpt-oss-120b`, what Groq retains).
- **Q7.** Razorpay: confirm the wording for payment-data sharing and
  whether any other data (e.g. name) is sent beyond email + phone.
- **Q8.** Insurance partner: name + licence number, and the exact
  fields shared per lead — before any real partner goes live.
- **Q9.** AdMob: confirm the data AdMob collects (advertising ID,
  device data) for the policy's third-party list.
- **Q10.** Children's data: the app is for adult drivers; confirm the
  intended minimum age and whether any age gate is wanted.
- **Q11.** Data principal rights process: how does a user request
  access / correction / deletion / grievance escalation in practice
  (email? in-app? response time)? The policy must give a real process,
  not just an email address.
- **Q12.** Confirm the Firestore database region in the Firebase
  console (it is not stated anywhere in the repo — `asia-south1` is
  evidenced only for Cloud Functions, `src/integrations/firebase/client.ts`,
  and must not be assumed for the database) and that Firebase/Google
  as processors may be named in the policy.

## 13. What this draft is NOT

- Not a privacy policy. Do not paste it into the app or publish it.
- Not legal advice and not a DPDP / IT Rules compliance assessment.
- Not a complete sub-processor list: only processors found in the code
  are named (Firebase/Google, Groq, Razorpay, AdMob). If the owner uses
  any other tool with user data (support desk, analytics, email), it
  must be added here first.
- Next step: owner answers Q1–Q12, then a lawyer (or the owner, at
  their own risk) rewrites the in-app policy from this map, fixing the
  §11 gaps. Only then is the policy updated in the app.
