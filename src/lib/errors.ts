/**
 * Maps raw backend errors (Firebase / Firestore / Supabase) to short,
 * user-friendly messages for display in toasts.
 *
 * Raw SDK messages ("Firebase: Error (auth/…)", "Missing or insufficient
 * permissions.", PostgREST details, …) must never reach the UI — the raw
 * error still belongs in console logs for debugging. Messages the app
 * throws itself for validation (plain `new Error("…")` with no backend
 * code attached) are already user-friendly and pass through unchanged.
 */

const GENERIC_CODE_MESSAGES: Record<string, string> = {
  "permission-denied": "You don't have permission to do that.",
  unauthenticated: "Please sign in again to continue.",
  unavailable:
    "Service is temporarily unavailable. Please check your connection and try again.",
  "deadline-exceeded": "That took too long. Please try again.",
  "already-exists": "This already exists.",
  "not-found": "That item could not be found.",
  "resource-exhausted": "Too many requests. Please wait a moment and try again.",
  cancelled: "The operation was cancelled.",
  "invalid-argument": "Some of the information entered isn't valid.",
  "failed-precondition": "This action can't be completed right now.",
  aborted: "The operation was interrupted. Please try again.",
  internal: "Something went wrong on our side. Please try again.",
  unknown: "Something went wrong. Please try again.",
  "data-loss": "Something went wrong. Please try again.",
  "out-of-range": "Some of the information entered isn't valid.",
  unimplemented: "This feature isn't available yet.",
};

const CODE_MESSAGES: Record<string, string> = {
  ...GENERIC_CODE_MESSAGES,
  // Firebase Auth codes not already normalized by the auth flow
  // (see formatAuthError in src/hooks/useAuthActions.ts).
  "auth/invalid-credential": "Invalid email or password. Please check and try again.",
  "auth/wrong-password": "Invalid email or password. Please check and try again.",
  "auth/user-not-found": "Invalid email or password. Please check and try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed":
    "Network problem. Please check your connection and try again.",
  "auth/requires-recent-login": "Please sign in again to complete this action.",
  "auth/no-current-user": "Please sign in again to continue.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled right now.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/id-token-expired": "Your session has expired. Please sign in again.",
  "auth/user-token-expired": "Your session has expired. Please sign in again.",
  // Firebase Storage codes
  "storage/unauthorized": "You don't have permission to upload this file.",
  "storage/canceled": "The upload was cancelled.",
  "storage/object-not-found": "That file could not be found.",
  "storage/retry-limit-exceeded":
    "Upload failed after several attempts. Please try again.",
  "storage/invalid-argument": "That file couldn't be uploaded.",
  // PostgREST / Postgres codes surfaced by the backend layer
  PGRST301: "Please sign in again to continue.",
  PGRST116: "That item could not be found.",
  "42501": "You don't have permission to do that.",
  "23505": "This already exists.",
  "23503": "This item is linked to other data and can't be changed.",
};

// Patterns that mark a message as raw backend/SDK output which should
// never be shown to users verbatim.
const RAW_MESSAGE_PATTERNS: RegExp[] = [
  /firebase/i,
  /firestore/i,
  /supabase/i,
  /postgrest/i,
  /missing or insufficient permissions/i,
  /duplicate key/i,
  /violates .* constraint/i,
  /row-level security/i,
  /\bPGRST\d+\b/,
  /\bJWT\b/,
  /permission-denied/,
  /unauthenticated/,
];

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function extractCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  const message = getMessage(error);
  // Raw Firebase SDK messages look like "Firebase: Error (auth/…)".
  const match = message.match(/\(([a-z][a-z-]*\/[a-z-]+)\)/i);
  if (match) return match[1];
  if (/missing or insufficient permissions/i.test(message)) {
    return "permission-denied";
  }
  return null;
}

function lookupCode(code: string): string | null {
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  // Namespaced variants (e.g. "firestore/permission-denied",
  // "functions/not-found") fall back to the generic bare-code message.
  const bare = code.includes("/") ? code.split("/").pop()! : code;
  if (bare !== code && GENERIC_CODE_MESSAGES[bare]) {
    return GENERIC_CODE_MESSAGES[bare];
  }
  return null;
}

export function friendlyErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const code = extractCode(error);
  if (code) {
    // The error came from a backend SDK: show the mapped friendly
    // message, or the generic fallback — never the raw message.
    return lookupCode(code) ?? fallback;
  }

  const message = getMessage(error);
  if (!message) return fallback;

  if (/failed to fetch|network request failed|load failed/i.test(message)) {
    return "Network problem. Please check your connection and try again.";
  }

  if (RAW_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }

  // Plain messages thrown by the app itself (form validation etc.) are
  // already written for users — pass them through unchanged.
  return message;
}
