import type { Env } from "../config/env.js";
import { isNebulaConfigured, nebulaJson } from "./nebula-client.js";

export type NebulaProspectList = {
  id: string;
  name: string;
  status: string;
  prospectCount: number;
  label: string;
};

export type NebulaProspectListContact = {
  externalContactId: string;
  phoneNumber: string;
  name: string;
  company: string;
  title: string;
  activity: string;
  status: string;
  emailStatus: string | null;
  lastOutboundAt: string | null;
  lastOutboundType: string | null;
  lastInboundAt: string | null;
  lastInboundType: string | null;
};

type ProspectListRow = {
  id: string;
  name: string;
  status: string;
  prospect_count: number | null;
  updated_at: string | null;
};

type ProspectListContactRow = {
  contact_key: string;
  custom_fields: Record<string, unknown> | null;
  contact_status: string | null;
  status: string | null;
  last_activity_at: string | null;
  last_outbound_activity_at: string | null;
  last_outbound_activity_type: string | null;
  last_inbound_activity_at: string | null;
  last_inbound_activity_type: string | null;
};

type GtmOutreachRow = {
  new_key: string;
  phone: string | null;
  mobile: string | null;
  name: string | null;
  company: string | null;
  jobTitle: string | null;
  email_status: string | null;
};

const e164Like = /^\+[1-9]\d{6,14}$/;

export function formatProspectListLabel(list: {
  name: string;
  status: string;
  prospectCount: number;
}): string {
  const countLabel = list.prospectCount === 1 ? "1 contact" : `${list.prospectCount} contacts`;
  return `${list.name} (${countLabel})`;
}

export function normalizePhoneToE164(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const trimmed = raw.trim();
  if (e164Like.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

function pickPhone(
  contact: ProspectListContactRow,
  gtm: GtmOutreachRow | undefined,
): string | null {
  const custom = contact.custom_fields ?? {};
  const candidates = [
    gtm?.mobile,
    gtm?.phone,
    typeof custom.mobile === "string" ? custom.mobile : null,
    typeof custom.phone === "string" ? custom.phone : null,
    typeof custom.contact_phone === "string" ? custom.contact_phone : null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePhoneToE164(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function pickString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function formatActivity(contact: ProspectListContactRow): string {
  return (
    pickString(
      contact.last_outbound_activity_type,
      contact.last_inbound_activity_type,
      contact.status,
      contact.contact_status,
    ) ?? "none"
  );
}

export async function listProspectListsForAgent(
  env: Env,
  agentId: string,
): Promise<NebulaProspectList[]> {
  if (!isNebulaConfigured(env)) {
    return [];
  }

  const rows = await nebulaJson<ProspectListRow[]>(
    env,
    "/rest/v1/prospect_lists_with_counts",
    {
      select: "id,name,status,prospect_count,updated_at",
      owner_id: `eq.${agentId}`,
      order: "updated_at.desc.nullslast,name.asc",
    },
  );

  return rows.map((row) => {
    const prospectCount = row.prospect_count ?? 0;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      prospectCount,
      label: formatProspectListLabel({
        name: row.name,
        status: row.status,
        prospectCount,
      }),
    };
  });
}

async function fetchGtmByContactKeys(
  env: Env,
  contactKeys: string[],
): Promise<Map<string, GtmOutreachRow>> {
  const byKey = new Map<string, GtmOutreachRow>();
  const chunkSize = 100;

  for (let offset = 0; offset < contactKeys.length; offset += chunkSize) {
    const chunk = contactKeys.slice(offset, offset + chunkSize);
    if (chunk.length === 0) {
      continue;
    }

    const quoted = chunk.map((key) => `"${key.replaceAll('"', '\\"')}"`).join(",");
    const rows = await nebulaJson<GtmOutreachRow[]>(env, "/rest/v1/gtm_outreach", {
      select: "new_key,name,company,jobTitle,phone,mobile,email_status",
      new_key: `in.(${quoted})`,
    });

    for (const row of rows) {
      byKey.set(row.new_key, row);
    }
  }

  return byKey;
}

export async function listProspectListContacts(
  env: Env,
  listId: string,
): Promise<{
  contacts: NebulaProspectListContact[];
  totalInList: number;
  skippedWithoutPhone: number;
}> {
  if (!isNebulaConfigured(env)) {
    return { contacts: [], totalInList: 0, skippedWithoutPhone: 0 };
  }

  const pageSize = 1000;
  const contacts: ProspectListContactRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const rows = await nebulaJson<ProspectListContactRow[]>(
      env,
      "/rest/v1/prospect_list_contacts",
      {
        select:
          "contact_key,custom_fields,contact_status,status,last_activity_at,last_outbound_activity_at,last_outbound_activity_type,last_inbound_activity_at,last_inbound_activity_type",
        list_id: `eq.${listId}`,
        order: "added_at.asc",
        limit: String(pageSize),
        offset: String(offset),
      },
    );

    contacts.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
  }

  const gtmByKey = await fetchGtmByContactKeys(
    env,
    contacts.map((contact) => contact.contact_key),
  );

  const dialable: NebulaProspectListContact[] = [];

  for (const contact of contacts) {
    const gtm = gtmByKey.get(contact.contact_key);
    const custom = contact.custom_fields ?? {};
    const phoneNumber = pickPhone(contact, gtm);
    if (!phoneNumber) {
      continue;
    }

    dialable.push({
      externalContactId: contact.contact_key,
      phoneNumber,
      name: pickString(
        gtm?.name,
        typeof custom.name === "string" ? custom.name : null,
        typeof custom.full_name === "string" ? custom.full_name : null,
      ) ?? "Unknown",
      company:
        pickString(
          gtm?.company,
          typeof custom.company === "string" ? custom.company : null,
        ) ?? "Unknown Company",
      title:
        pickString(
          gtm?.jobTitle,
          typeof custom.title === "string" ? custom.title : null,
        ) ?? "Unknown Title",
      activity: formatActivity(contact),
      status: contact.contact_status ?? "active",
      emailStatus: gtm?.email_status ?? null,
      lastOutboundAt: contact.last_outbound_activity_at,
      lastOutboundType: contact.last_outbound_activity_type,
      lastInboundAt: contact.last_inbound_activity_at,
      lastInboundType: contact.last_inbound_activity_type,
    });
  }

  return {
    contacts: dialable,
    totalInList: contacts.length,
    skippedWithoutPhone: contacts.length - dialable.length,
  };
}
