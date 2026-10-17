# Roadmap

## Date-picker repair
- [x] Touch-friendly controlled pickers, tests, Android/desktop checks.

## Chat history 1 day (plan written, approval interrupted)
- [ ] Keep Assistant/Finance AI history 24h — waiting: user to re-approve after Firebase decision.

## Firebase migration (staged, production stays on current backend)
- [x] Firebase workspace: firebase.json, Firestore/Storage rules, indexes.
- [x] Cloud Functions ports: chat, financeAi, adminListUsers, deleteAccount, sendNotifications, cleanupTransactions.
- [x] Rules emulator tests, env template, import scripts with UID mapping.
- [ ] Register Firebase web app + provide web config — blocked: owner action in Firebase console.
- [ ] Deploy rules/functions, set function secrets — blocked: Firebase CLI login / service account.
- [ ] Export + import users/data, verify, then switch frontend — blocked: above steps.
