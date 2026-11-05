import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";

// Subscription nudges master flag (admin on/off, default OFF). Reads the
// Firestore doc config/subscription_nudges, field `enabled`.
// Fail-closed: while the flag is loading, on error, or when the doc or its
// `enabled` field is missing or false, nudges are OFF. Every nudge surface
// (trial popup, expiry push, AI upgrade card) checks this hook.
export function useSubscriptionNudges() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["subscription_nudges"],
    queryFn: async () => {
      const { data, error } = await db.from("config").select("*").eq("id", "subscription_nudges");
      if (error) throw error;
      const rows = data as { id: string; enabled?: boolean }[];
      return rows[0]?.enabled ?? false;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  return { enabled: data === true, isLoading };
}
