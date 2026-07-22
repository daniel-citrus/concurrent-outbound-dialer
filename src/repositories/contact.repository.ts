import type { DbClient, DbPool } from "../database/pool.js";
import type { DialingContact } from "../domain/contact.js";
import type { ContactStatus } from "../domain/statuses.js";
import { mapContact, type ContactRow } from "./mappers.js";

type Queryable = DbPool | DbClient;

export class ContactRepository {
  constructor(private readonly db: Queryable) {}

  async insertMany(
    client: DbClient,
    sessionId: string,
    contacts: Array<{ externalContactId: string; phoneNumber: string }>,
  ): Promise<DialingContact[]> {
    const created: DialingContact[] = [];
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact) continue;
      const result = await client.query<ContactRow>(
        `INSERT INTO dialing_contacts (
           session_id, external_contact_id, phone_number, position, status
         ) VALUES ($1, $2, $3, $4, 'queued')
         RETURNING *`,
        [sessionId, contact.externalContactId, contact.phoneNumber, i],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Failed to insert contact");
      }
      created.push(mapContact(row));
    }
    return created;
  }

  async listBySession(
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DialingContact[]> {
    const limit = options.limit ?? 10_000;
    const offset = options.offset ?? 0;
    const result = await this.db.query<ContactRow>(
      `SELECT * FROM dialing_contacts
       WHERE session_id = $1
       ORDER BY position
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset],
    );
    return result.rows.map(mapContact);
  }

  async countByStatus(sessionId: string): Promise<Record<string, number>> {
    const result = await this.db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count
       FROM dialing_contacts
       WHERE session_id = $1
       GROUP BY status`,
      [sessionId],
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  async updateStatus(
    contactId: string,
    status: ContactStatus,
    patches: { claimedAt?: Date | null; completedAt?: Date | null } = {},
  ): Promise<DialingContact | null> {
    const sets = ["status = $2", "updated_at = NOW()"];
    const params: unknown[] = [contactId, status];
    let idx = 3;
    if (patches.claimedAt !== undefined) {
      sets.push(`claimed_at = $${idx++}`);
      params.push(patches.claimedAt);
    }
    if (patches.completedAt !== undefined) {
      sets.push(`completed_at = $${idx++}`);
      params.push(patches.completedAt);
    }
    const result = await this.db.query<ContactRow>(
      `UPDATE dialing_contacts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    const row = result.rows[0];
    return row ? mapContact(row) : null;
  }

  async findById(contactId: string): Promise<DialingContact | null> {
    const result = await this.db.query<ContactRow>(
      `SELECT * FROM dialing_contacts WHERE id = $1`,
      [contactId],
    );
    const row = result.rows[0];
    return row ? mapContact(row) : null;
  }
}
