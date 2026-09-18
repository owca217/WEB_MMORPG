import type { InjuryKind } from "@web-mmorpg/shared";
import type { DbExecutor } from "./dbTypes";

interface InjuryRow {
  injury_kind: InjuryKind;
}

export class InjuryRepository {
  constructor(private readonly db: DbExecutor) {}

  async load(characterId: string): Promise<InjuryKind[]> {
    const result = await this.db.query<InjuryRow>(
      `SELECT injury_kind
       FROM character_injuries
       WHERE character_id = $1
       ORDER BY injury_kind`,
      [characterId]
    );

    return result.rows.map((row) => row.injury_kind);
  }

  async replaceAll(
    characterId: string,
    injuries: readonly InjuryKind[]
  ): Promise<void> {
    await this.db.query(
      "DELETE FROM character_injuries WHERE character_id = $1",
      [characterId]
    );

    for (const injury of injuries) {
      await this.db.query(
        `INSERT INTO character_injuries (character_id, injury_kind)
         VALUES ($1,$2)`,
        [characterId, injury]
      );
    }
  }
}
