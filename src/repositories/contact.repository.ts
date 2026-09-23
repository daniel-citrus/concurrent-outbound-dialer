import type { DialerSupabase } from "../database/supabase.js";
import { throwIfError } from "../database/supabase.js";
import type { DialingContact } from "../domain/contact.js";
import type { ContactStatus } from "../domain/statuses.js";
import { mapContact, type ContactRow } from "./mappers.js";

export class ContactRepository {
  constructor(private readonly sb: DialerSupabase) {}

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DialingContact[]> {
    const limit = options.limit ?? 10_000;
    const offset = options.offset ?? 0;
    const { data, error } = await this.sb
      .from("dialing_contacts")
      .select("*")
      .eq("session_id", sessionId)
      .order("position", { ascending: true })
      .range(offset, offset + limit - 1);
    throwIfError(error, "list contacts");
    return (data ?? []).map((row) => mapContact(row as ContactRow));
  }

  async countByStatus(sessionId: string): Promise<Record<string, number>> {
    const { data, error } = await this.sb
      .from("dialing_contacts")
      .select("status")
      .eq("session_id", sessionId);
    throwIfError(error, "count contacts by status");
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const status = (row as { status: string }).status;
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  async updateStatus(
    contactId: string,
    status: ContactStatus,
    patches: { claimedAt?: Date | null; completedAt?: Date | null } = {},
  ): Promise<DialingContact | null> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (patches.claimedAt !== undefined) {
      update.claimed_at = patches.claimedAt?.toISOString() ?? null;
    }
    if (patches.completedAt !== undefined) {
      update.completed_at = patches.completedAt?.toISOString() ?? null;
    }
    const { data, error } = await this.sb
      .from("dialing_contacts")
      .update(update)
      .eq("id", contactId)
      .select("*")
      .maybeSingle();
    throwIfError(error, "update contact status");
    return data ? mapContact(data as ContactRow) : null;
  }

  async findById(contactId: string): Promise<DialingContact | null> {
    const { data, error } = await this.sb
      .from("dialing_contacts")
      .select("*")
      .eq("id", contactId)
      .maybeSingle();
    throwIfError(error, "find contact");
    return data ? mapContact(data as ContactRow) : null;
  }
}
