import { learnWeaponSkill, normalizeWeaponTraining, resetWeaponSkillFamily, type WeaponTraining } from "@web-mmorpg/shared";
import type { Pool } from "pg";

export type WeaponSkillMutation = { kind: "learn"; skillId: unknown } | { kind: "reset"; family: unknown };

/** A lost COMMIT response must not allow a later disconnect save to erase the authorized choice. */
export class WeaponSkillWriteUncertainError extends Error {
  constructor(readonly training: WeaponTraining) { super("WEAPON_SKILL_REQUEST_UNCERTAIN"); }
}

export class WeaponSkillService {
  private readonly unresolvedChoices = new Map<string, WeaponTraining>();
  constructor(private readonly pool: Pool) {}

  async apply(characterId: string, request: WeaponSkillMutation, assertCurrent: () => void): Promise<WeaponTraining> {
    const client = await this.pool.connect();
    let committing = false;
    let released = false;
    let next: WeaponTraining | undefined;
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ weapon_training: unknown }>(
        `SELECT character.weapon_training FROM characters character JOIN accounts account ON account.id=character.account_id
         WHERE character.id=$1 AND account.status='active' AND character.deletion_requested_at IS NULL
           AND character.deletion_effective_at IS NULL FOR UPDATE OF character FOR SHARE OF account`, [characterId]
      );
      if (!locked.rowCount) throw new Error("CHARACTER_NOT_FOUND");
      const stored = normalizeWeaponTraining(locked.rows[0]!.weapon_training);
      const unresolved = this.unresolvedChoices.get(characterId);
      // If both a COMMIT reply and its readback were lost, retain that authorized choice
      // on a subsequent action while taking the latest earned XP from the locked row.
      const baseline = unresolved ? { ...stored, learnedSkills: unresolved.learnedSkills ?? [] } : stored;
      next = normalizeWeaponTraining(request.kind === "learn"
        ? learnWeaponSkill(baseline, request.skillId)
        : resetWeaponSkillFamily(baseline, request.family));
      await client.query("UPDATE characters SET weapon_training=$2::jsonb,updated_at=NOW() WHERE id=$1", [characterId, JSON.stringify(next)]);
      // The caller reserves this character against new saves, battles, trading and equipment mutations.
      assertCurrent();
      committing = true;
      await client.query("COMMIT");
      this.unresolvedChoices.delete(characterId);
      return next;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (committing && next) {
        client.release(true);
        released = true;
        try {
          const stored = await this.pool.query<{ weapon_training: unknown }>("SELECT weapon_training FROM characters WHERE id=$1", [characterId]);
          if (stored.rows[0]) {
            const canonical = normalizeWeaponTraining(stored.rows[0].weapon_training);
            if (JSON.stringify(canonical) === JSON.stringify(next)) {
              this.unresolvedChoices.delete(characterId);
              return canonical;
            }
          }
        } catch {
          this.unresolvedChoices.set(characterId, next);
          throw new WeaponSkillWriteUncertainError(next);
        }
      }
      throw error;
    } finally { if (!released) client.release(); }
  }
}
