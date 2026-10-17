# Firebase migration (staged — NOT live)

Production still runs on the current backend. Nothing here is deployed or wired into the app.

## Status
| Stage | State |
|---|---|
| Code ready (rules, indexes, functions, import/verify scripts, rules tests) | done |
| Firebase deployed | not done — needs owner access |
| Users/data migrated | not done |
| Frontend switched | not done (all pages still use the current backend client) |

## Owner setup (in order)
1. Firebase console → project `driver-saathi-app` → add a **Web app**; copy its config into the app's env (see `.env.example`). `public/google-services.json` is the Android app only and grants no admin access.
2. Upgrade to Blaze plan (needed for Functions + outbound AI calls). Enable Auth providers: Email/Password and Google.
3. `firebase login`, then from `firebase/`: `firebase functions:secrets:set GOOGLE_AI_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (reuse current VAPID keys so existing web-push subscriptions keep working).
4. `cd functions && npm i && npm run test:rules` (emulator), then `firebase deploy --only firestore,storage,functions`.
5. Migration (read-only on the old database): create a Firebase service-account key, set `GOOGLE_APPLICATION_CREDENTIALS` and `SUPABASE_DB_URL`, then `cd migration && npm i && node import.mjs --dry-run`, `node import.mjs`, `node verify.mjs`.
6. Copy Storage objects (`avatars/`, `marketplace/`) and rewrite `avatar_url` / `media_url`.
7. Port the frontend data layer page by page behind `VITE_BACKEND`, test, then switch. Keep old backend until verified.

## Constraints
- UIDs: Firebase UID = existing user UUID, so every `user_id`/FK reference stays valid.
- Passwords: bcrypt hashes import with `BCRYPT`; if the DB connection lacks `auth` schema access, users must reset passwords.
- Google users: linked by email/provider id; first Google sign-in on Firebase may require the Android SHA-1 to be registered.
- Admin: `admin` custom claim + server-only `roles/{uid}` doc; clients can never write either.
- Assistant `chat` function ports 3 of the existing tools; the rest of `supabase/functions/chat` must be ported before cutover.
- Native FCM push sending (`fcm://` tokens) is still to be added to `sendNotifications`.
