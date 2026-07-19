import type { DbClient } from "../database/pool.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { DialingContact } from "../domain/contact.js";
import { mapCallAttempt, mapContact, type CallAttemptRow, type ContactRow } from "./mappers.js";

export type ReservedClaim = {
  contact: DialingContact;
  callAttempt: CallAttempt;
};

/**
 * Transactionally claim queued contacts with FOR UPDATE SKIP LOCKED
 * and create call_attempts in `creating` status.
 */
export async function claimContactsAndReserveAttempts(
  client: DbClient,
  sessionId: string,
  limit: number,
): Promise<ReservedClaim[]> {
  if (limit <= 0) {
    return [];
  }

  const result = await client.query<{
    contact_id: string;
    call_attempt_id: string;
  }>(
    `
    WITH claimed AS (
      SELECT id
      FROM dialing_contacts
      WHERE session_id = $1
        AND status = 'queued'
      ORDER BY position
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    ),
    updated_contacts AS (
      UPDATE dialing_contacts dc
      SET
        status = 'claimed',
        claimed_at = NOW(),
        updated_at = NOW()
      FROM claimed
      WHERE dc.id = claimed.id
      RETURNING dc.*
    ),
    inserted_attempts AS (
      INSERT INTO call_attempts (session_id, contact_id, status)
      SELECT $1, uc.id, 'creating'
      FROM updated_contacts uc
      RETURNING *
    ),
    contact_events AS (
      INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
      SELECT
        $1,
        ia.id,
        'contact_claimed',
        jsonb_build_object('contactId', uc.id, 'position', uc.position)
      FROM updated_contacts uc
      JOIN inserted_attempts ia ON ia.contact_id = uc.id
    ),
    attempt_events AS (
      INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
      SELECT
        $1,
        ia.id,
        'call_reserved',
        jsonb_build_object('contactId', ia.contact_id)
      FROM inserted_attempts ia
    )
    SELECT
      uc.id AS contact_id,
      ia.id AS call_attempt_id
    FROM updated_contacts uc
    JOIN inserted_attempts ia ON ia.contact_id = uc.id
    ORDER BY uc.position
    `,
    [sessionId, limit],
  );

  const claims: ReservedClaim[] = [];
  for (const row of result.rows) {
    const contactResult = await client.query<ContactRow>(
      `SELECT * FROM dialing_contacts WHERE id = $1`,
      [row.contact_id],
    );
    const attemptResult = await client.query<CallAttemptRow>(
      `SELECT * FROM call_attempts WHERE id = $1`,
      [row.call_attempt_id],
    );
    const contactRow = contactResult.rows[0];
    const attemptRow = attemptResult.rows[0];
    if (!contactRow || !attemptRow) {
      continue;
    }
    claims.push({
      contact: mapContact(contactRow),
      callAttempt: mapCallAttempt(attemptRow),
    });
  }
  return claims;
}
