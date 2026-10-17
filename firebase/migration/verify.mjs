// Compares row counts per user/table between Supabase and Firestore. Exit code 1 on any mismatch.
import pg from "pg";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
initializeApp({ credential: applicationDefault(), projectId: "driver-saathi-app" });
const fs = getFirestore();
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL }); await db.connect();
const TABLES = ["transactions","debts","debt_payments","goals","notes","reminders","car_checks","car_documents",
  "health_logs","emergency_contacts","platform_affiliations","push_subscriptions","chat_messages",
  "recurring_expenses","recurring_expense_payments"];
let bad = 0;
const { rows: [{ n }] } = await db.query("select count(*)::int n from auth.users");
let fbUsers = 0, tok; do { const p = await getAuth().listUsers(1000, tok); fbUsers += p.users.length; tok = p.pageToken; } while (tok);
if (n !== fbUsers) { bad++; console.error(`auth users: supabase ${n} vs firebase ${fbUsers}`); }
for (const t of TABLES) {
  const { rows } = await db.query(`select user_id, count(*)::int c from public.${t} group by user_id`);
  for (const r of rows) {
    const c = (await fs.collection(`users/${r.user_id}/${t}`).count().get()).data().count;
    if (c !== r.c) { bad++; console.error(`${t} ${r.user_id}: ${r.c} vs ${c}`); }
  }
}
await db.end();
console.log(bad ? `${bad} mismatches` : "all counts match");
process.exit(bad ? 1 : 0);
