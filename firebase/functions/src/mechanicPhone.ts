// When a mechanic changes their phone number, the old verification must not
// carry over to the new number: the new number was never checked by the
// admin. Clear the flag so the admin verifies the new number (admin panel
// "Verify phone"). The client cannot do this itself: Firestore rules deny
// client writes to phoneVerified/phoneVerifiedAt, so the server enforces it.
// The admin's own "Verify phone" write never touches `phone`, so it is
// unaffected. The clearing write re-fires this trigger once, but then
// before.phone === after.phone, so it exits immediately (no loop).
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db, FieldValue } from "./shared";

const REGION = "asia-south1";

export const clearPhoneVerifiedOnChange = onDocumentUpdated(
  { document: "mechanics/{mechanicId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.phone === after.phone) return;
    if (!before.phoneVerified) return;
    await db.doc(`mechanics/${event.params.mechanicId}`).update({
      phoneVerified: false,
      phoneVerifiedAt: FieldValue.delete(),
    });
  },
);
