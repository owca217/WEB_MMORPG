import { randomUUID } from "node:crypto";
import type { CharacterLifecycleSummary, InjuryKind } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import {
  CharacterRepository,
  type PersistedCharacterRecord
} from "../persistence/CharacterRepository";

const START_LOCATION = "forest-settlement-01";
const START_X = 360;
const START_Y = 470;

export class CharacterLifecycleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CharacterLifecycleError";
  }
}

function normalizeNickname(input: string): { display: string; normalized: string } | null {
  const display = input.trim();
  if (display.length < 3 || display.length > 20) return null;
  return { display, normalized: display.toLowerCase() };
}

function validAppearance(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export class CharacterLifecycleService {
  constructor(private readonly pool: Pool) {}

  async getLifecycle(
    accountId: string,
    _now: Date = new Date()
  ): Promise<CharacterLifecycleSummary> {
    const character = await new CharacterRepository(this.pool).findByAccountId(accountId);
    if (!character) return { state: "none" };
    if (character.deletionEffectiveAt) {
      return {
        state: "pendingDeletion",
        characterId: character.id,
        nickname: character.nickname,
        deletionEffectiveAt: character.deletionEffectiveAt.toISOString()
      };
    }
    return {
      state: "active",
      characterId: character.id,
      nickname: character.nickname
    };
  }

  getCharacter(accountId: string): Promise<PersistedCharacterRecord | null> {
    return new CharacterRepository(this.pool).findByAccountId(accountId);
  }

  async createCharacter(
    accountId: string,
    input: { nickname: string; appearance: unknown }
  ): Promise<PersistedCharacterRecord> {
    const nickname = normalizeNickname(input.nickname);
    if (!nickname) {
      throw new CharacterLifecycleError(
        "INVALID_NICKNAME",
        400,
        "Character nickname must contain between 3 and 20 characters."
      );
    }
    if (!validAppearance(input.appearance)) {
      throw new CharacterLifecycleError(
        "INVALID_APPEARANCE",
        400,
        "Character appearance must be an object."
      );
    }

    const repository = new CharacterRepository(this.pool);
    if (await repository.findByAccountId(accountId)) {
      throw new CharacterLifecycleError(
        "CHARACTER_ALREADY_EXISTS",
        409,
        "This account already owns a character."
      );
    }

    try {
      return await repository.create({
        id: randomUUID(),
        accountId,
        nickname: nickname.display,
        nicknameNormalized: nickname.normalized,
        appearance: input.appearance,
        locationId: START_LOCATION,
        x: START_X,
        y: START_Y
      });
    } catch (error) {
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

  async saveGameplayState(
    characterId: string,
    state: {
      locationId: string;
      x: number;
      y: number;
      level: number;
      hp: number;
      maxHp: number;
      maxAp: number;
      initiative: number;
      severelyInjured: boolean;
      injuries: InjuryKind[];
    }
  ): Promise<void> {
    await new CharacterRepository(this.pool).updateGameplayState(characterId, state);
  }
}
