import { expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";

it("trains families independently, caps progress and keeps returned snapshots isolated",()=>{
  const service=new CharacterService();service.createPlayer("hero","Hero");
  const first=service.trainWeapon("hero","sword",5);
  expect(first.weaponTraining?.experience).toEqual({sword:5,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0});
  service.trainWeapon("hero","bow",25251);
  const loaded=service.setWeaponLoadout("hero",{melee:"axe",ranged:"bow"});
  loaded.weaponTraining!.experience.bow=999;loaded.weaponTraining!.loadout.melee="sword";
  expect(service.getSnapshot("hero")?.weaponTraining).toMatchObject({experience:{sword:5,bow:25250},loadout:{melee:"axe",ranged:"bow"}});
  for(const amount of [-1,0.5,NaN,Infinity])expect(()=>service.trainWeapon("hero","sword",amount)).toThrow("INVALID_WEAPON_EXPERIENCE");
  expect(()=>service.trainWeapon("hero","wand" as "sword",1)).toThrow("INVALID_WEAPON_FAMILY");
  expect(()=>service.setWeaponLoadout("hero",{melee:"bow",ranged:"sword"} as never)).toThrow("INVALID_WEAPON_LOADOUT");
  expect(service.getSnapshot("hero")?.weaponTraining?.experience.sword).toBe(5);
});

it("recalculates bonuses from base statistics through hydrate and character level ups",()=>{
  const service=new CharacterService();const fresh=service.createPlayer("hero","Hero");
  const input={...fresh,weaponTraining:{experience:{sword:25250,axe:0,hammer:0,dagger:0,spear:0,bow:25250,crossbow:0},loadout:{melee:"sword" as const,ranged:"bow" as const}}};
  const hydrated=service.hydrate(input);input.weaponTraining.experience.sword=0;
  expect(hydrated.statistics).toMatchObject({strength:10,meleeDamage:25,rangedDamage:19});
  expect(service.hydrate(hydrated).statistics).toMatchObject({meleeDamage:25,rangedDamage:19});
  const leveled=service.awardExperience("hero",100);
  expect(leveled.statistics).toMatchObject({strength:12,meleeDamage:28,rangedDamage:20});
  expect(service.setWeaponLoadout("hero",{melee:"axe",ranged:"crossbow"}).statistics).toMatchObject({meleeDamage:22,rangedDamage:16});
});
