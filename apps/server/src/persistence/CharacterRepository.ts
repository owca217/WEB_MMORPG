import type { AppearanceSelection } from "@web-mmorpg/shared";
import type { DbExecutor } from "./dbTypes";

export interface PersistedCharacterRecord {
  id: string;
  accountId: string;
  nickname: string;
  nicknameNormalized: string;
  appearance: AppearanceSelection;
  locationId: string;
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  deletionRequestedAt: Date | null;
  deletionEffectiveAt: Date | null;
}

interface CharacterRow {
  id: string;
  account_id: string;
  nickname: string;
  nickname_normalized: string;
  appearance: AppearanceSelection;
  location_id: string;
  x: number;
  y: number;
  level: number;
  hp: number;
  max_hp: number;
  max_ap: number;
  initiative: number;
  severely_injured: boolean;
  deletion_requested_at: Date | null;
  deletion_effective_at: Date | null;
}

const SELECT_COLUMNS = `
  id, account_id, nickname, nickname_normalized, appearance,
  location_id, x, y, level, hp, max_hp, max_ap, initiative,
  severely_injured, deletion_requested_at, deletion_effective_at
`;

function mapCharacter(row: CharacterRow): PersistedCharacterRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    nickname: row.nickname,
    nicknameNormalized: row.nickname_normalized,
    appearance: row.appearance,
    locationId: row.location_id,
    x: Number(row.x),
    y: Number(row.y),
    level: row.level,
    hp: row.hp,
    maxHp: row.max_hp,
    maxAp: row.max_ap,
    initiative: row.initiative,
    severelyInjured: row.severely_injured,
    deletionRequestedAt: row.deletion_requested_at,
    deletionEffectiveAt: row.deletion_effective_at
  };
}

export class CharacterRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(input: {
    id: string;
    accountId: string;
    nickname: string;
    nicknameNormalized: string;
    appearance: AppearanceSelection;
    locationId: string;
    x: number;
    y: number;
  }): Promise<PersistedCharacterRecord> {
    const result = await this.db.query<CharacterRow>(
      `INSERT INTO characters
       (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.id,
        input.accountId,
        input.nickname,
        input.nicknameNormalized,
        input.appearance,
        input.locationId,
        input.x,
        input.y
      ]
    );
    return mapCharacter(result.rows[0]!);
  }

  async findByAccountId(accountId: string): Promise<PersistedCharacterRecord | null> {
    const result = await this.db.query<CharacterRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM characters
       WHERE account_id = $1`,
      [accountId]
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : null;
  }

  async findById(id: string): Promise<PersistedCharacterRecord | null> {
    const result = await this.db.query<CharacterRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM characters
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : null;
  }

  async findByNormalizedNickname(
    normalized: string
  ): Promise<PersistedCharacterRecord | null> {
    const result = await this.db.query<CharacterRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM characters
       WHERE nickname_normalized = $1`,
      [normalized]
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : null;
  }
}
