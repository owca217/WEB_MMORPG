import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { normalizeWeaponTraining } from "@web-mmorpg/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { CharacterRepository } from "../src/persistence/CharacterRepository";

const databaseUrl=process.env.DATABASE_URL;
const describeDatabase=databaseUrl ? describe : describe.skip;
describeDatabase("persistent weapon proficiency migration",()=>{
  const pool=createPool(databaseUrl);
  beforeEach(async()=>{
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query("CREATE TABLE schema_migrations(migration_name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    for(const name of ["001_item_catalog","002_account_auth","003_item_icon_assets","004_item_special_fields","005_character_progression","006_container_slots","007_social","008_merchant"]) {
      await pool.query(await readFile(new URL(`../src/db/migrations/${name}.sql`,import.meta.url),"utf8"));
      await pool.query("INSERT INTO schema_migrations(migration_name) VALUES($1)",[name]);
    }
  });
  afterAll(async()=>{await pool.end();});

  it("preserves legacy characters and round-trips training without older saves erasing it",async()=>{
    const accountId=randomUUID(),id=randomUUID();
    await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,'weapons','weapons','password-hash','recovery-hash')",[accountId]);
    await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized,appearance,level,experience,hp,max_hp) VALUES($1,$2,'Hero','hero','{\"gender\":\"female\",\"skinId\":\"female-guard\"}',4,600,150,190)",[id,accountId]);
    await runMigrations(pool);await runMigrations(pool);
    const repository=new CharacterRepository(pool);
    const legacy=await repository.findById(id);
    expect(legacy).toMatchObject({accountId,level:4,experience:600,hp:150,appearance:{gender:"female",skinId:"female-guard"},weaponTraining:normalizeWeaponTraining(undefined)});
    const training=normalizeWeaponTraining({experience:{sword:15,axe:6,crossbow:40},loadout:{melee:"axe",ranged:"crossbow"}});
    const state={locationId:legacy!.locationId,x:legacy!.x,y:legacy!.y,level:legacy!.level,experience:legacy!.experience,hp:legacy!.hp,maxHp:legacy!.maxHp,maxAp:legacy!.maxAp,initiative:legacy!.initiative,severelyInjured:legacy!.severelyInjured,injuries:legacy!.injuries};
    await repository.updateGameplayState(id,{...state,weaponTraining:training});
    expect((await repository.findById(id))?.weaponTraining).toEqual(training);
    await repository.updateGameplayState(id,{...state,hp:140});
    expect(await repository.findById(id)).toMatchObject({hp:140,weaponTraining:training});
    await pool.query(await readFile(new URL("../src/db/migrations/009_weapon_proficiencies.sql",import.meta.url),"utf8"));
    expect((await repository.findById(id))?.weaponTraining).toEqual(training);
    await expect(pool.query("UPDATE characters SET weapon_training='[]'::jsonb WHERE id=$1",[id])).rejects.toMatchObject({code:"23514"});
  });
});
