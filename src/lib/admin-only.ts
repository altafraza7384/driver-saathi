// Admin-only account: altafraza7384@gmail.com logs into the Driver Saathi
// app as admin only — never as a driver user. Added 2026-11-02 at the user's
// explicit scope: ONLY this email, NOT razakhan.chino@gmail.com (who stays
// user + admin). Used by the login redirect, the ProtectedRoutes gate, the
// Admin Users list, and ensureProfile.
export const ADMIN_ONLY_EMAIL = "altafraza7384@gmail.com";

export function isAdminOnlyAccount(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_ONLY_EMAIL;
}
