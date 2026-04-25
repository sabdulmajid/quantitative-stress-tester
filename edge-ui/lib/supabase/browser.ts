import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

let client: SupabaseClient | null = null;

export function createBrowserSupabaseClient() {
  const env = getSupabaseEnv();
  if (!env.enabled) {
    throw new Error("Supabase environment variables are not configured");
  }

  if (!client) {
    client = createBrowserClient(env.url, env.key);
  }

  return client;
}
