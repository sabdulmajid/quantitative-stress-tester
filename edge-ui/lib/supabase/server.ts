import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/supabase/env";

type CookieMutation = {
  name: string;
  value: string;
  options?: {
    domain?: string;
    path?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none" | boolean;
  };
};

export async function createServerSupabaseClient(accessToken?: string | null) {
  const env = getSupabaseEnv();
  if (!env.enabled) {
    return null;
  }

  const cookieStore = await cookies();
  const global =
    accessToken && accessToken.trim()
      ? {
          headers: {
            Authorization: `Bearer ${accessToken.trim()}`
          }
        }
      : undefined;

  return createServerClient(env.url, env.key, {
    global,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieMutation[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes are only available in route handlers, proxy, and server actions.
        }
      }
    }
  });
}
