import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DialerSupabase = SupabaseClient;

export function createDialerSupabase(
  url: string,
  serviceRoleKey: string,
): DialerSupabase {
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return e.code === "23505" || Boolean(e.message?.includes("duplicate"));
}

export function throwIfError(error: unknown, context: string): asserts error is null {
  if (error) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new Error(`${context}: ${message}`);
  }
}
