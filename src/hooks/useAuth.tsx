import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
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

  const queryClient = useQueryClient();
  const prevUidRef = useRef<string | null | undefined>(undefined);
  
  useEffect(() => {
    let isMounted = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const applySession = (nextSession: Session | null) => {
      if (!isMounted) return;
      // Account changed (login as another user, or logout): drop every
      // cached query, otherwise the previous account's profile, budgets
      // and transactions keep showing (query keys carry no user id).
      // Same-user token refreshes must NOT clear the cache.
      const nextUid = nextSession?.user?.id ?? null;
      if (prevUidRef.current !== undefined && prevUidRef.current !== nextUid) {
        // Cancel FIRST: a fetch started under the old account must not
        // resolve after the clear and write the old account's data back.
        queryClient.cancelQueries();
        queryClient.clear();
      }
      prevUidRef.current = nextUid;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    };

    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);

    });

    // Always bootstrap session — keep user logged in indefinitely
    const bootstrapSession = async () => {
      fallbackTimer = setTimeout(() => {
        if (isMounted) setLoading(false);
      }, 4000);

      try {
        const { data, error } = await db.auth.getSession();
        if (error) throw error;
        applySession(data.session ?? null);
      } catch (error) {
        console.error("Auth session bootstrap failed", error);
        // Only clear local session for genuine network failures or token errors.
        // For other errors, keep loading=false but don't wipe state — onAuthStateChange will reconcile.
        if (isMounted) setLoading(false);
      } finally {
        if (fallbackTimer) clearTimeout(fallbackTimer);
      }
    };

    void bootstrapSession();

    return () => {
      isMounted = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await db.auth.signOut();
    } catch (error) {
      console.error("Sign out failed, clearing local session", error);
      await db.auth.signOut({ scope: "local" });
    }
    queryClient.cancelQueries();
    queryClient.clear();
  };

  return <AuthContext.Provider value={{ user, session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
