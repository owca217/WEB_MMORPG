import type { DbExecutor } from "./dbTypes";

export interface NicknameReservation {
  normalized: string;
  display: string;
  formerAccountId: string;
  reservedUntil: Date;
}

interface ReservationRow {
  nickname_normalized: string;
  display_nickname: string;
  former_account_id: string;
  reserved_until: Date;
}

function mapReservation(row: ReservationRow): NicknameReservation {
  return {
    normalized: row.nickname_normalized,
    display: row.display_nickname,
    formerAccountId: row.former_account_id,
    reservedUntil: row.reserved_until
  };
}

export class NicknameReservationRepository {
  constructor(private readonly db: DbExecutor) {}

  async findActive(
    normalized: string,
    now: Date
  ): Promise<NicknameReservation | null> {
    const result = await this.db.query<ReservationRow>(
      `SELECT nickname_normalized, display_nickname,
              former_account_id, reserved_until
       FROM reserved_nicknames
       WHERE nickname_normalized = $1
         AND reserved_until > $2`,
      [normalized, now]
    );

    return result.rows[0] ? mapReservation(result.rows[0]) : null;
  }

  async reserve(input: {
    normalized: string;
    display: string;
    formerAccountId: string;
    reservedUntil: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO reserved_nicknames
       (nickname_normalized, display_nickname, former_account_id, reserved_until)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (nickname_normalized)
       DO UPDATE SET
         display_nickname = EXCLUDED.display_nickname,
         former_account_id = EXCLUDED.former_account_id,
         reserved_until = EXCLUDED.reserved_until`,
      [
        input.normalized,
        input.display,
        input.formerAccountId,
        input.reservedUntil
      ]
    );
  }

  async deleteExpired(normalized: string, now: Date): Promise<void> {
    await this.db.query(
      `DELETE FROM reserved_nicknames
       WHERE nickname_normalized = $1
         AND reserved_until <= $2`,
      [normalized, now]
    );
  }
}
