// Staged import: Supabase Postgres -> Firebase Auth + Firestore.
// Run on the owner's machine:  node import.mjs [--dry-run] [--users-only]
// Requires GOOGLE_APPLICATION_CREDENTIALS (Firebase service account) and SUPABASE_DB_URL.
// Read-only on Supabase. Firebase UID = Supabase UUID, so every user_id relationship is preserved.
import pg from "pg";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const DRY = process.argv.includes("--dry-run");
const USERS_ONLY = process.argv.includes("--users-only");
initializeApp({ credential: applicationDefault(), projectId: "driver-saathi-app" });
const auth = getAuth(); const fs = getFirestore();
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await db.connect();

const USER_TABLES = ["transactions","debts","debt_payments","goals","notes","reminders","car_checks","car_documents",
  "health_logs","emergency_contacts","platform_affiliations","push_subscriptions","chat_messages",
  "recurring_expenses","recurring_expense_payments"];
const iso = (v) => (v instanceof Date ? v.toISOString() : v);
const clean = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, iso(v)]));

// 1) Auth users. Supabase stores bcrypt hashes in auth.users.encrypted_password -> Firebase BCRYPT import.
const { rows: users } = await db.query(`select id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, last_sign_in_at from auth.users`);
const { rows: identities } = await db.query(`select user_id, provider, provider_id from auth.identities`);
const { rows: admins } = await db.query(`select user_id from public.user_roles where role='admin'`);
const adminSet = new Set(admins.map((r) => r.user_id));
const records = users.map((u) => ({
  uid: u.id, email: u.email ?? undefined, emailVerified: !!u.email_confirmed_at,
  displayName: u.raw_user_meta_data?.full_name ?? undefined,
  passwordHash: u.encrypted_password ? Buffer.from(u.encrypted_password) : undefined,
  customClaims: adminSet.has(u.id) ? { admin: true } : undefined,
  providerData: identities.filter((i) => i.user_id === u.id && i.provider === "google")
    .map((i) => ({ uid: i.provider_id, providerId: "google.com", email: u.email ?? undefined })),
  metadata: { creationTime: iso(u.created_at), lastSignInTime: iso(u.last_sign_in_at) ?? undefined },
}));
console.log(`users: ${records.length} (admins: ${adminSet.size})`);
if (!DRY) for (let i = 0; i < records.length; i += 1000) {
  const res = await auth.importUsers(records.slice(i, i + 1000), { hash: { algorithm: "BCRYPT" } });
  res.errors.forEach((e) => console.error("user import error", records[i + e.index].uid, e.error.message));
}

// 2) Roles (server-only collection)
const { rows: roles } = await db.query(`select user_id, array_agg(role::text) roles from public.user_roles group by user_id`);
if (!DRY) for (const r of roles) await fs.doc(`roles/${r.user_id}`).set({ roles: r.roles });
if (USERS_ONLY) process.exit(0);

// 3) Profiles + per-user data (doc id = original row UUID; FKs like debt_id/expense_id kept as fields)
const writer = DRY ? null : fs.bulkWriter();
const { rows: profiles } = await db.query(`select * from public.profiles`);
profiles.forEach((p) => writer?.set(fs.doc(`users/${p.user_id}`), clean(p)));
for (const t of USER_TABLES) {
  const { rows } = await db.query(`select * from public.${t}`);
  console.log(`${t}: ${rows.length}`);
  rows.forEach((r) => writer?.set(fs.doc(`users/${r.user_id}/${t}/${r.id}`), clean(r)));
}
// 4) Shared catalogs
for (const t of ["subscription_plans", "marketplace_categories", "marketplace_posts"]) {
  const { rows } = await db.query(`select * from public.${t}`);
  console.log(`${t}: ${rows.length}`);
  rows.forEach((r) => writer?.set(fs.doc(`${t}/${r.id}`), clean(r)));
}
await writer?.close();
await db.end();
console.log(DRY ? "dry run complete — nothing written" : "import complete — run verify.mjs next");
