// Admin-only account: altafraza7384@gmail.com logs into the Driver Saathi
// app as admin only — never as a driver user. Added 2026-11-02 at the user's
// explicit scope: ONLY this email, NOT any other account. razakhan.chino@gmail.com was removed from admin on 2026-11-02 and is now user-only.
// Used by the login redirect, the ProtectedRoutes gate, the
// Admin Users list, and ensureProfile.
export const ADMIN_ONLY_EMAIL = "altafraza7384@gmail.com";
export function isAdminOnlyAccount(email: unknown): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === ADMIN_ONLY_EMAIL;
}
