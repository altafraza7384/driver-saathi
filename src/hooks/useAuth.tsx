import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

const isLikelyNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("timed out")
  );
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const applySession = (nextSession: Session | null) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);

      // Mark browser tab as having an active session (for keepSignedIn=false logic)
      if (_event === "SIGNED_IN" && nextSession) {
        const keep = localStorage.getItem("keepSignedIn");
        if (keep === "false") {
          sessionStorage.setItem("activeSession", "true");
        }
      }
    });

    // If keepSignedIn was explicitly set to false and the browser was closed/reopened
    // (sessionStorage is cleared on browser close), clear the persisted auth session.
    const keepSignedIn = localStorage.getItem("keepSignedIn");
    const hasActiveSession = sessionStorage.getItem("activeSession");

    if (keepSignedIn === "false" && !hasActiveSession) {
      // Browser was closed — user chose not to stay signed in
      supabase.auth.signOut({ scope: "local" }).then(() => {
        localStorage.removeItem("keepSignedIn");
        if (isMounted) applySession(null);
      });
    } else {
      // Normal bootstrap — keep session alive indefinitely
      const bootstrapSession = async () => {
        fallbackTimer = setTimeout(() => {
          if (isMounted) setLoading(false);
        }, 4000);

        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          applySession(data.session ?? null);
        } catch (error) {
          console.error("Auth session bootstrap failed", error);
          if (!isLikelyNetworkError(error)) {
            applySession(null);
          } else {
            if (isMounted) setLoading(false);
          }
        } finally {
          if (fallbackTimer) clearTimeout(fallbackTimer);
        }
      };

      void bootstrapSession();
    }

    return () => {
      isMounted = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      // Clean up keepSignedIn preference on explicit logout
      localStorage.removeItem("keepSignedIn");
      sessionStorage.removeItem("activeSession");
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Sign out failed, clearing local session", error);
      await supabase.auth.signOut({ scope: "local" });
    }
  };

  return <AuthContext.Provider value={{ user, session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
