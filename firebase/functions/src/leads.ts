import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "./shared";

const REGION = "asia-south1";

// Mirrors the form's phone normalisation (InsuranceLeadPage.tsx) so a
// bypassed write with "+91 ..." or "0..." still matches the stored lead.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

// Server-side duplicate guard for insurance_leads (added post-Blaze).
// The 30-day duplicate check in the app is client-side only, so a direct
// API write can bypass it and spam the admin queue. This trigger deletes
// such a bypassed duplicate within seconds of creation. Honest users
// never hit it: the form itself blocks resubmission and shows the
// duplicate message. Rejected leads never block, so a corrected
// resubmission (e.g. mistyped vehicle number) stays possible — same
// rule as the client check.
export const dedupeInsuranceLead = onDocumentCreated(
  { document: "insurance_leads/{leadId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const lead = snap.data() as Record<string, unknown>;
    if (lead.status !== "new") return;
    const userId = typeof lead.user_id === "string" ? lead.user_id : "";
    const phone = normalizePhone(typeof lead.phone === "string" ? lead.phone : "");
    if (!userId || !phone) return;
    const vehicle =
      typeof lead.vehicle_number === "string" ? lead.vehicle_number.trim().toUpperCase() : "";
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    // One equality filter only (no composite index needed): a user's
    // lead list is tiny, so the 30-day + phone + vehicle match is done
    // in code, mirroring the client check exactly.
    const prior = await db
      .collection("insurance_leads")
      .where("user_id", "==", userId)
      .get();
    const dup = prior.docs.some((d) => {
      if (d.id === snap.id) return false;
      const o = d.data() as Record<string, unknown>;
      if (o.status === "rejected") return false;
      if (normalizePhone(typeof o.phone === "string" ? o.phone : "") !== phone) return false;
      if (!o.created_at || new Date(String(o.created_at)).getTime() < cutoff) return false;
      const oldVehicle =
        typeof o.vehicle_number === "string" ? o.vehicle_number.trim().toUpperCase() : "";
      if (!oldVehicle && !vehicle) return true;
      return oldVehicle === vehicle;
    });
    if (dup) await snap.ref.delete();
  },
);
