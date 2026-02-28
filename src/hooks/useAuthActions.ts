import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const AUTH_TIMEOUT_MS = 30000;
const OAUTH_TIMEOUT_MS = 45000;
const MAX_RETRIES = 4;

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
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("err_internet") ||
    msg.includes("err_connection") ||
    msg.includes("err_network") ||
    msg.includes("net::") ||
    msg.includes("the internet connection appears to be offline") ||
    msg.includes("a server with the specified hostname could not be found")
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

const runWithRetry = async <T>(
  action: () => Promise<T>,
  retries = MAX_RETRIES,
  onRetry?: (attempt: number, maxRetries: number) => void
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isLikelyNetworkError(error) || attempt === retries) break;

      // Exponential backoff: 500ms, 1s, 2s, 4s
      const backoff = Math.min(500 * Math.pow(2, attempt), 5000);
      onRetry?.(attempt + 1, retries);
      await wait(backoff);
    }
  }

  throw lastError;
};

const ensureOnline = () => {
  // Only block if definitively offline — navigator.onLine is unreliable on slow connections
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("No internet connection. Please reconnect and try again.");
  }
};

const clearLocalAuthSession = async () => {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.warn("Failed to clear local auth session", error);
  }
};

export function formatAuthError(error: unknown) {
  const msg = getErrorMessage(error);
  const lowerMsg = msg.toLowerCase();

  if (isLikelyNetworkError(error)) {
    return "Slow or unstable internet detected. Please wait and try again — the app will retry automatically.";
  }

  if (lowerMsg.includes("email not confirmed")) {
    return "Please verify your email from inbox before logging in.";
  }

  if (lowerMsg.includes("oauth secret") || lowerMsg.includes("unsupported provider")) {
    return "Google sign-in is temporarily unavailable. Please use email/password login.";
  }

  if (lowerMsg.includes("invalid login credentials")) {
    return "Invalid email or password. Please check and try again.";
  }

  return msg;
}

export function useAuthActions() {
  const signInWithPassword = async (
    email: string,
    password: string,
    onRetry?: (attempt: number, maxRetries: number) => void
  ) => {
    ensureOnline();

    try {
      const { error } = await runWithRetry(
        () =>
          withTimeout(
            supabase.auth.signInWithPassword({ email, password }),
            AUTH_TIMEOUT_MS,
            "Login request timed out. Please check your internet and try again."
          ),
        MAX_RETRIES,
        onRetry
      );

      if (error) throw error;
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        await clearLocalAuthSession();
      }
      throw error;
    }
  };

  const signUpWithPassword = async (
    email: string,
    password: string,
    fullName: string,
    onRetry?: (attempt: number, maxRetries: number) => void
  ) => {
    ensureOnline();

    try {
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
            "Signup request timed out. Please check your internet and try again."
          ),
        MAX_RETRIES,
        onRetry
      );

      if (error) throw error;
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        await clearLocalAuthSession();
      }
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    ensureOnline();

    try {
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
            "Google sign-in request timed out. Please check your internet and try again."
          ),
        MAX_RETRIES
      );

      if (result?.error) {
        throw result.error;
      }

      return result;
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        await clearLocalAuthSession();
      }
      throw error;
    }
  };

  return {
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
  };
}
