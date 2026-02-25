import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const AUTH_TIMEOUT_MS = 15000;
const OAUTH_TIMEOUT_MS = 20000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
};

const isLikelyNetworkError = (error: unknown) => {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const runWithRetry = async <T>(action: () => Promise<T>, retries = 1): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isLikelyNetworkError(error) || attempt === retries) break;
      await wait(500 * (attempt + 1));
    }
  }

  throw lastError;
};

const ensureOnline = () => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("No internet connection. Please reconnect and try again.");
  }
};

export function formatAuthError(error: unknown) {
  const msg = getErrorMessage(error);
  const lowerMsg = msg.toLowerCase();

  if (isLikelyNetworkError(error)) {
    return "Network issue while contacting authentication service. Please check internet and try again.";
  }

  if (lowerMsg.includes("email not confirmed")) {
    return "Please verify your email from inbox before logging in.";
  }

  if (lowerMsg.includes("oauth secret") || lowerMsg.includes("unsupported provider")) {
    return "Google sign-in is temporarily unavailable. Please use email/password login.";
  }

  return msg;
}

export function useAuthActions() {
  const signInWithPassword = async (email: string, password: string) => {
    ensureOnline();

    const { error } = await runWithRetry(
      () =>
        withTimeout(
          supabase.auth.signInWithPassword({ email, password }),
          AUTH_TIMEOUT_MS,
          "Authentication request timed out."
        ),
      1
    );

    if (error) throw error;
  };

  const signUpWithPassword = async (email: string, password: string, fullName: string) => {
    ensureOnline();

    const { error } = await runWithRetry(
      () =>
        withTimeout(
          supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName },
              emailRedirectTo: window.location.origin,
            },
          }),
          AUTH_TIMEOUT_MS,
          "Signup request timed out."
        ),
      1
    );

    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    ensureOnline();

    const result = await runWithRetry(
      () =>
        withTimeout(
          lovable.auth.signInWithOAuth("google", {
            redirect_uri: window.location.origin,
            extraParams: {
              prompt: "select_account",
            },
          }),
          OAUTH_TIMEOUT_MS,
          "Google sign-in request timed out."
        ),
      1
    );

    if (result?.error) {
      throw result.error;
    }

    return result;
  };

  return {
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
  };
}
