import { describe, expect, it } from "vitest";
import { findNearestWalkablePosition, isWorldPositionWalkable, resolveWorldMovement } from "../src/worldCollision";
import { findWorldPath } from "../src/worldNavigation";

const SETTLEMENT="forest-settlement-01",FOREST="eastern-forest-01";
describe("world collision footprints and navigation",()=>{
  it("blocks trunks, rocks, buildings and fences while leaving the gate and portal arrivals open",()=>{
    for(const point of [{x:72,y:136},{x:1090,y:340},{x:245,y:235},{x:500,y:150}])expect(isWorldPositionWalkable(SETTLEMENT,point)).toBe(false);
    for(const point of [{x:360,y:470},{x:910,y:470},{x:1450,y:450}])expect(isWorldPositionWalkable(SETTLEMENT,point)).toBe(true);
    expect(isWorldPositionWalkable(FOREST,{x:150,y:600})).toBe(true);
    expect(resolveWorldMovement(SETTLEMENT,{x:860,y:470},{x:1000,y:470})).toEqual({x:1000,y:470});
  });
  it("sweeps the full requested segment instead of tunneling through an obstacle",()=>{
    const building=resolveWorldMovement(SETTLEMENT,{x:400,y:255},{x:90,y:255});
    expect(building.x).toBeGreaterThanOrEqual(380);expect(building.x).toBeLessThan(381);
    const rock=resolveWorldMovement(SETTLEMENT,{x:1030,y:340},{x:1150,y:340});
    expect(rock.x).toBeLessThanOrEqual(1058.01);expect(isWorldPositionWalkable(SETTLEMENT,rock)).toBe(true);
  });
  it("slides along a blocked edge without increasing the movement distance",()=>{
    const from={x:400,y:350},to={x:300,y:250},result=resolveWorldMovement(SETTLEMENT,from,to);
    expect(result.x).toBeLessThan(380);expect(result.y).toBeGreaterThanOrEqual(319.99);
    expect(Math.hypot(result.x-from.x,result.y-from.y)).toBeLessThanOrEqual(Math.hypot(to.x-from.x,to.y-from.y));
    expect(isWorldPositionWalkable(SETTLEMENT,result)).toBe(true);
    expect(resolveWorldMovement(SETTLEMENT,{x:400,y:320},{x:300,y:320})).toEqual({x:300,y:320});
  });
  it("recovers legacy positions saved inside a trunk or building",()=>{
    for(const blocked of [{x:72,y:136},{x:245,y:235}]){
      const nearest=findNearestWalkablePosition(SETTLEMENT,blocked);
      expect(isWorldPositionWalkable(SETTLEMENT,nearest)).toBe(true);
      expect(Math.hypot(nearest.x-blocked.x,nearest.y-blocked.y)).toBeLessThan(180);
      expect(isWorldPositionWalkable(SETTLEMENT,resolveWorldMovement(SETTLEMENT,blocked,{x:400,y:470}))).toBe(true);
    }
  });
  it("finds a forest route whose complete segments avoid obstacles",()=>{
    const from={x:150,y:600},target={x:900,y:780},path=findWorldPath(FOREST,from,target);
    expect(path).not.toBeNull();expect(path!.at(-1)).toEqual(target);
    let previous=from;for(const point of path!){expect(resolveWorldMovement(FOREST,previous,point)).toEqual(point);previous=point;}
  });
  it("routes to a reachable interaction point outside Ada's building",()=>{
    const from={x:360,y:470},npc={x:720,y:535},path=findWorldPath(SETTLEMENT,from,npc,{arrivalRadius:79});
    expect(path).not.toBeNull();const goal=path!.at(-1)!;
    expect(Math.hypot(goal.x-npc.x,goal.y-npc.y)).toBeLessThanOrEqual(79);
    expect(isWorldPositionWalkable(SETTLEMENT,goal)).toBe(true);
    let previous=from;for(const point of path!){expect(resolveWorldMovement(SETTLEMENT,previous,point)).toEqual(point);previous=point;}
  });
  it("uses an exterior goal when a click is directly on a blocking trunk",()=>{
    const path=findWorldPath(SETTLEMENT,{x:30,y:200},{x:72,y:136});
    expect(path).not.toBeNull();expect(isWorldPositionWalkable(SETTLEMENT,path!.at(-1)!)).toBe(true);
    expect(Math.hypot(path!.at(-1)!.x-72,path!.at(-1)!.y-136)).toBeLessThanOrEqual(96);
  });
});
