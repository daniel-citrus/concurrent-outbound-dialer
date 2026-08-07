import type { DialerSupabase } from "../database/supabase.js";
import { throwIfError } from "../database/supabase.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { DialingContact } from "../domain/contact.js";
import { mapCallAttempt, mapContact, type CallAttemptRow, type ContactRow } from "./mappers.js";

export type ReservedClaim = {
  contact: DialingContact;
  callAttempt: CallAttempt;
};

/**
 * Atomically claim queued contacts via dialer_claim_contacts RPC
 * (FOR UPDATE SKIP LOCKED + creating call_attempts).
 */
export async function claimContactsAndReserveAttempts(
  sb: DialerSupabase,
  sessionId: string,
  limit: number,
): Promise<ReservedClaim[]> {
  if (limit <= 0) {
    return [];
  }

  const { data, error } = await sb.rpc("dialer_claim_contacts", {
    p_session_id: sessionId,
    p_limit: limit,
  });
  throwIfError(error, "claim contacts");

  const rows = (data ?? []) as Array<{
    contact: ContactRow;
    call_attempt: CallAttemptRow;
  }>;

  return rows.map((row) => ({
    contact: mapContact(row.contact),
    callAttempt: mapCallAttempt(row.call_attempt),
  }));
}
