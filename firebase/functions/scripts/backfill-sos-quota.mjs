#!/usr/bin/env node
/**
 * One-time SOS quota backfill (audit item 5 rollout, 2026-11-21).
 *
 * Claims sos_requests whose SERVER-ASSIGNED createTime falls inside the
 * given IST day (default: today IST), so the 5-per-IST-day limit is
 * exact from the first minute of the rollout — including requests made
 * before the functions deploy. Eligibility is by createTime, never the
 * client-written created_at field (which can be missing or wrong). The
 * whole collection is paged, so no same-day historical doc is missed.
 *
 * Idempotent: every doc is claimed by flipping its `counted` flag inside
 * the same transaction that increments the counter (the exact protocol
 * in claimSosCreateDoc/countSosCreateIfUnclaimed, imported from the
 * compiled functions). Re-runs, late runs past midnight and races with
 * the sosLegacyCreateCounter trigger converge on count == 1 per doc, and
 * a stale-day claim never overwrites a newer day's counter.
 *
 * Usage (same credential pattern as the Supabase migration, see
 * firebase/README.md):
 *   cd firebase/functions && bun run build
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/backfill-sos-quota.mjs [--day YYYY-MM-DD] [--dry-run]
 */
import { countSosCreateIfUnclaimed, istDayIso } from "../lib/sosCreate.js";
import { db } from "../lib/shared.js";
import { FieldPath } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dayIdx = args.indexOf("--day");
const day = dayIdx >= 0 ? args[dayIdx + 1] : istDayIso(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error(`bad --day "${day}" (want YYYY-MM-DD, an IST calendar day)`);
  process.exit(2);
}

const startMs = new Date(`${day}T00:00:00+05:30`).getTime();
const endMs = startMs + 86_400_000;

let scanned = 0, eligible = 0, claimed = 0, already = 0, failed = 0;
let last = null;
for (;;) {
  let q = db.collection("sos_requests").orderBy(FieldPath.documentId()).limit(300);
  if (last) q = q.startAfter(last);
  const page = await q.get();
  if (page.empty) break;
  for (const doc of page.docs) {
    scanned++;
    const ct = doc.createTime ? doc.createTime.toDate().getTime() : 0;
    if (ct < startMs || ct >= endMs) continue;
    eligible++;
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
  last = page.docs[page.docs.length - 1];
}
console.log(
  `${dryRun ? "[dry-run] " : ""}IST day ${day}: scanned ${scanned}, eligible ${eligible}, ` +
  `${claimed} ${dryRun ? "would be claimed" : "claimed"}, ${already} already counted, ${failed} failed`,
);
process.exit(failed ? 1 : 0);
