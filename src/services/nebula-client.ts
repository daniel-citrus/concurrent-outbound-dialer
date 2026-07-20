import type { Env } from "../config/env.js";

export function isNebulaConfigured(env: Env): boolean {
  return Boolean(env.NEBULA_SUPABASE_URL && env.NEBULA_SUPABASE_SERVICE_ROLE_KEY);
}

export async function nebulaFetch(
  env: Env,
  resourcePath: string,
  searchParams?: Record<string, string>,
): Promise<Response> {
  if (!isNebulaConfigured(env)) {
    throw new Error("Nebula Supabase is not configured");
  }

  const url = new URL(resourcePath, env.NEBULA_SUPABASE_URL);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  return fetch(url, {
    headers: {
      apikey: env.NEBULA_SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${env.NEBULA_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

export async function nebulaJson<T>(
  env: Env,
  resourcePath: string,
  searchParams?: Record<string, string>,
): Promise<T> {
  const response = await nebulaFetch(env, resourcePath, searchParams);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Nebula request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}
