import { randomUUID } from "node:crypto";
import { verifyPassword } from "../auth/credentials";
import type {
  AppearanceSelection,
  CharacterLifecycleSummary,
  CharacterProfile
} from "@web-mmorpg/shared";
import { isAppearanceSelection } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { AccountRepository } from "../persistence/AccountRepository";
import {
  CharacterRepository,
  type PersistedCharacterRecord
} from "../persistence/CharacterRepository";
import { NicknameReservationRepository } from "../persistence/NicknameReservationRepository";
import { FOREST_SETTLEMENT_01 } from "../world/worldFixtures";
import { validateNickname } from "./nickname";

export class CharacterLifecycleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }

  async requestDeletion(
    accountId: string,
    password: string,
    now = new Date()
  ): Promise<CharacterLifecycleSummary> {
    const account =
      await new AccountRepository(this.pool).findById(accountId);
    if (!account || !(await verifyPassword(account.passwordHash, password))) {
      throw new CharacterLifecycleError(
        "INVALID_PASSWORD",
        401,
        "Current account password is incorrect."
      );
    }

    const character =
      await new CharacterRepository(this.pool).findByAccountId(accountId);
    if (!character) {
      throw new CharacterLifecycleError(
        "CHARACTER_NOT_FOUND",
        404,
        "This account has no character."
      );
    }

    if (
      character.deletionEffectiveAt &&
      character.deletionEffectiveAt <= now
    ) {
      await this.finalizeCharacter(character, now);
      return { state: "none" };
    }

    if (character.deletionEffectiveAt) {
      return this.lifecycleFromCharacter(character);
    }

    const effectiveAt = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    );
    await new CharacterRepository(this.pool).markDeletionRequested(
      character.id,
      now,
      effectiveAt
    );

    return {
      state: "pendingDeletion",
      characterId: character.id,
      nickname: character.nickname,
      deletionEffectiveAt: effectiveAt.toISOString()
    };
  }

  async cancelDeletion(
    accountId: string,
    now = new Date()
  ): Promise<CharacterLifecycleSummary> {
    const character =
      await new CharacterRepository(this.pool).findByAccountId(accountId);
    if (!character) return { state: "none" };

    if (
      character.deletionEffectiveAt &&
      character.deletionEffectiveAt <= now
    ) {
      await this.finalizeCharacter(character, now);
      return { state: "none" };
    }

    if (character.deletionEffectiveAt) {
      await new CharacterRepository(this.pool).cancelDeletion(
        character.id
      );
    }

    return {
      state: "active",
      characterId: character.id,
      nickname: character.nickname
    };
  }

  private lifecycleFromCharacter(
    character: PersistedCharacterRecord
  ): CharacterLifecycleSummary {
    if (character.deletionEffectiveAt) {
      return {
        state: "pendingDeletion",
        characterId: character.id,
        nickname: character.nickname,
        deletionEffectiveAt:
          character.deletionEffectiveAt.toISOString()
      };
    }

    return {
      state: "active",
      characterId: character.id,
      nickname: character.nickname
    };
  }

  private async finalizeCharacter(
    character: PersistedCharacterRecord,
    now: Date
  ): Promise<void> {
    if (
      !character.deletionEffectiveAt ||
      character.deletionEffectiveAt > now
    ) {
      return;
    }

    await withTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [character.nicknameNormalized]
      );

      const characters = new CharacterRepository(client);
      const current = await characters.findByIdForUpdate(character.id);
      if (
        !current?.deletionEffectiveAt ||
        current.deletionEffectiveAt > now
      ) {
        return;
      }

      await new NicknameReservationRepository(client).reserve({
        normalized: current.nicknameNormalized,
        display: current.nickname,
        formerAccountId: current.accountId,
        reservedUntil: new Date(
          current.deletionEffectiveAt.getTime() +
            7 * 24 * 60 * 60 * 1000
        )
      });
      await characters.deleteById(current.id);
    });
  }
}

function hasPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  );
}

function toProfile(character: PersistedCharacterRecord): CharacterProfile {
  return {
    id: character.id,
    nickname: character.nickname,
    appearance: character.appearance
  };
}

export class CharacterLifecycleService {
  constructor(private readonly pool: Pool) {}

  async getLifecycle(
    accountId: string,
    now: Date
  ): Promise<CharacterLifecycleSummary> {
    let character =
      await new CharacterRepository(this.pool).findByAccountId(accountId);
    if (!character) return { state: "none" };

    if (
      character.deletionEffectiveAt &&
      character.deletionEffectiveAt <= now
    ) {
      await this.finalizeCharacter(character, now);
      character =
        await new CharacterRepository(this.pool).findByAccountId(accountId);
      if (!character) return { state: "none" };
    }

    return this.lifecycleFromCharacter(character);
  }

  async getCharacter(accountId: string): Promise<CharacterProfile | null> {
    const character = await new CharacterRepository(this.pool).findByAccountId(accountId);
    return character ? toProfile(character) : null;
  }

  async createCharacter(
    accountId: string,
    input: { nickname: string; appearance: unknown },
    now = new Date()
  ): Promise<CharacterProfile> {
    const nickname = validateNickname(input.nickname);
    if (!nickname.ok) {
      throw new CharacterLifecycleError(
        nickname.code,
        400,
        "Character nickname is invalid."
      );
    }
    if (!isAppearanceSelection(input.appearance)) {
      throw new CharacterLifecycleError(
        "INVALID_APPEARANCE",
        400,
        "Character appearance contains an unsupported option."
      );
    }

    try {
      const existing =
        await new CharacterRepository(this.pool).findByAccountId(accountId);
      if (
        existing?.deletionEffectiveAt &&
        existing.deletionEffectiveAt <= now
      ) {
        await this.finalizeCharacter(existing, now);
      }

      const overdue =
        await new CharacterRepository(this.pool).findOverdueByNickname(
          nickname.normalized,
          now
        );
      if (overdue) {
        await this.finalizeCharacter(overdue, now);
      }

      const created = await withTransaction(this.pool, async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          [nickname.normalized]
        );

        const characters = new CharacterRepository(client);
        const reservations = new NicknameReservationRepository(client);

        if (await characters.findByAccountId(accountId)) {
          throw new CharacterLifecycleError(
            "CHARACTER_ALREADY_EXISTS",
            409,
            "This account already owns a character."
          );
        }

        await reservations.deleteExpired(nickname.normalized, now);
        if (await reservations.findActive(nickname.normalized, now)) {
          throw new CharacterLifecycleError(
            "NICKNAME_TAKEN",
            409,
            "That character nickname is temporarily reserved."
          );
        }

        return characters.create({
          id: randomUUID(),
          accountId,
          nickname: nickname.display,
          nicknameNormalized: nickname.normalized,
          appearance: input.appearance as AppearanceSelection,
          locationId: FOREST_SETTLEMENT_01.id,
          x: FOREST_SETTLEMENT_01.spawn.x,
          y: FOREST_SETTLEMENT_01.spawn.y
        });
      });

      return toProfile(created);
    } catch (error) {
      if (error instanceof CharacterLifecycleError) throw error;
      if (hasPgCode(error, "23505")) {
        throw new CharacterLifecycleError(
          "NICKNAME_TAKEN",
          409,
          "That character nickname is already taken."
        );
      }
      throw error;
    }
  }
}
