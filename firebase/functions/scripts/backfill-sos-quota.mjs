#!/usr/bin/env node
/**
 * One-time SOS quota backfill (audit item 5 rollout, 2026-11-21).
 *
 * Counts sos_requests created on the given IST day (default: today IST)
 * that predate the createSosRequest callable, so the 5-per-IST-day limit
 * is exact from the first minute of the rollout — including requests
 * made before the functions deploy.
 *
 * Idempotent: every doc is claimed by flipping its `counted` flag inside
 * the same transaction that increments the counter (the exact protocol
 * in countSosCreateIfUnclaimed, imported from the compiled functions).
 * Re-runs and races with the sosLegacyCreateCounter trigger converge on
 * count == 1 per doc. Safe to run repeatedly on rollout day.
 *
 * Usage (same credential pattern as the Supabase migration, see
 * firebase/README.md):
 *   cd firebase/functions && bun run build
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/backfill-sos-quota.mjs [--day YYYY-MM-DD] [--dry-run]
 */
import { countSosCreateIfUnclaimed, istDayIso } from "../lib/sosCreate.js";
import { db } from "../lib/shared.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dayIdx = args.indexOf("--day");
const day = dayIdx >= 0 ? args[dayIdx + 1] : istDayIso(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error(`bad --day "${day}" (want YYYY-MM-DD, an IST calendar day)`);
  process.exit(2);
}

// created_at is an ISO-8601 string; the IST day starts at 18:30 UTC the
// previous UTC day, and lexicographic compare on ISO strings is correct.
const startIso = new Date(`${day}T00:00:00+05:30`).toISOString();
const endIso = new Date(`${day}T00:00:00+05:30`).getTime() + 86_400_000;
const endIsoStr = new Date(endIso).toISOString();

const snap = await db
  .collection("sos_requests")
  .where("created_at", ">=", startIso)
  .where("created_at", "<", endIsoStr)
  .get();

let claimed = 0, already = 0, failed = 0;
for (const doc of snap.docs) {
  if (doc.get("counted") === true) { already++; continue; }
  if (dryRun) { claimed++; continue; }
  try {
    if (await countSosCreateIfUnclaimed(doc.id)) claimed++;
    else already++;
  } catch (e) {
    failed++;
    console.error(`FAILED ${doc.id}: ${e?.message ?? e}`);
  }
}
console.log(
  `${dryRun ? "[dry-run] " : ""}IST day ${day}: ${snap.size} sos_requests, ` +
  `${claimed} ${dryRun ? "would be claimed" : "claimed"}, ${already} already counted, ${failed} failed`,
);
process.exit(failed ? 1 : 0);
