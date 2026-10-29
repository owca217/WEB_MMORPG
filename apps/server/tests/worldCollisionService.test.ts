import { expect, it } from "vitest";
import { isWorldPositionWalkable } from "@web-mmorpg/shared";
import { WorldService } from "../src/world/WorldService";

it("rejects a long movement segment through the tavern while retaining speed limits",()=>{
  const world=new WorldService();world.addPlayer({id:"p",nickname:"Hero",x:400,y:255},0);
  const blocked=world.movePlayer("p",{x:90,y:255},100000);
  expect(blocked.x).toBeGreaterThanOrEqual(380);expect(blocked.x).toBeLessThan(381);
  expect(isWorldPositionWalkable("forest-settlement-01",blocked)).toBe(true);
  const next=world.movePlayer("p",{x:400,y:450},100010);
  expect(Math.hypot(next.x-blocked.x,next.y-blocked.y)).toBeLessThanOrEqual(2.20001);
});

it("normalizes old persisted positions inside an obstacle before exposing them",()=>{
  const world=new WorldService();const player=world.addPlayer({id:"p",nickname:"Hero",x:245,y:235},0);
  expect(isWorldPositionWalkable("forest-settlement-01",player)).toBe(true);
  expect(player).not.toMatchObject({x:245,y:235});
  expect(world.getPlayer("p")).toMatchObject({x:player.x,y:player.y});
});
