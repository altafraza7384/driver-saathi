import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { firebaseBackend } from "@/integrations/firebase/adapter";
import type { Database } from "@/integrations/supabase/types";

/**
 * Backend selector for the staged Firebase migration (see firebase/README.md).
 *
 * VITE_BACKEND=supabase (default): the real Supabase client.
 * VITE_BACKEND=firebase: the Firestore/Auth adapter in
 * src/integrations/firebase/adapter.ts, which implements the same client
 * surface the app uses. The cast keeps every call site typed against the
 * existing Database schema on both backends.
 */
export const BACKEND: "supabase" | "firebase" =
  import.meta.env.VITE_BACKEND === "firebase" ? "firebase" : "supabase";

export const db = (
  BACKEND === "firebase" ? firebaseBackend : supabase
) as unknown as SupabaseClient<Database>;
