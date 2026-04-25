export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    "";

  return {
    enabled: Boolean(url && key),
    url,
    key
  };
}

export function isSupabaseConfigured() {
  return getSupabaseEnv().enabled;
}
