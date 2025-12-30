import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

// Keep the function your app imports
export function createSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Optional: also export a singleton for convenience
export const supabase = createSupabaseClient();
