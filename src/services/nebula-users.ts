import type { Env } from "../config/env.js";
import { isNebulaConfigured, nebulaJson } from "./nebula-client.js";

export type NebulaUser = {
  id: string;
  email: string | null;
  name: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  label: string;
};

type NebulaUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

export function formatNebulaUserLabel(user: Omit<NebulaUser, "label">): string {
  const name =
    user.name ||
    user.fullName ||
    (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null) ||
    user.email?.split("@")[0] ||
    "Unknown";

  return user.email ? `${name} (${user.email})` : name;
}

export async function listNebulaUsers(env: Env): Promise<NebulaUser[]> {
  if (!isNebulaConfigured(env)) {
    return [];
  }

  const [rows, ownerIds] = await Promise.all([
    nebulaJson<NebulaUserRow[]>(env, "/rest/v1/nebula_user_profiles", {
      select: "id,email,name,full_name,first_name,last_name",
      order: "email.asc",
    }),
    listProspectListOwnerIds(env),
  ]);

  return rows
    .filter((row) => ownerIds.has(row.id))
    .map((row) => {
      const user = {
        id: row.id,
        email: row.email,
        name: row.name,
        fullName: row.full_name,
        firstName: row.first_name,
        lastName: row.last_name,
      };

      return {
        ...user,
        label: formatNebulaUserLabel(user),
      };
    });
}

async function listProspectListOwnerIds(env: Env): Promise<Set<string>> {
  const ownerIds = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const rows = await nebulaJson<Array<{ owner_id: string }>>(
      env,
      "/rest/v1/prospect_lists",
      {
        select: "owner_id",
        limit: String(pageSize),
        offset: String(offset),
      },
    );

    for (const row of rows) {
      ownerIds.add(row.owner_id);
    }

    if (rows.length < pageSize) {
      break;
    }
  }

  return ownerIds;
}
