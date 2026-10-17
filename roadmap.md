# Roadmap

## Date-picker repair
- [x] Touch-friendly controlled pickers, tests, Android/desktop checks.

## Chat history 1 day (plan written, approval interrupted)
- [ ] Keep Assistant/Finance AI history 24h — waiting: user to re-approve after Firebase decision.

## Firebase migration (staged, production stays on current backend)
- [x] Firebase workspace: firebase.json, Firestore/Storage rules, indexes.
- [x] Cloud Functions ports: chat, financeAi, adminListUsers, deleteAccount, sendNotifications, cleanupTransactions.
- [x] Rules emulator tests, env template, import scripts with UID mapping.
- [ ] Frontend runtime behind VITE_BACKEND (data/auth/storage/AI/push/admin adapters, Firebase SDK, strict web-config check) — in progress; audit done (27 files, query ops mapped, DB defaults read), code not written yet.
- [ ] Port all 21 assistant tools to Firebase (currently 3) + make health/debt/recurring updates atomic.
- [ ] Native FCM sending via firebase-admin messaging.
- [ ] Profile field whitelist rule, split Storage create/update/delete rules, move single-field group indexes to fieldOverrides.
- [ ] Harden import: stop on any Auth error, skip existing docs without overwriting, checkpoints, exact ID/content checks, password/Google sign-in checks, storage copy + URL rewrite, decisions for quota/notification/config tables.
- [ ] More tests: cross-user writes, entitlement fields, server functions.
- [ ] Register Firebase web app + provide web config — blocked: owner action in Firebase console.
- [ ] Deploy rules/functions, set function secrets — blocked: Firebase CLI login / service account.
- [ ] Export + import users/data, verify, then switch frontend — blocked: above steps.
