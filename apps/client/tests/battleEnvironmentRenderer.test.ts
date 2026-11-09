import type { BattleSnapshot } from "@web-mmorpg/shared";
import type Phaser from "phaser";
import { expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

import { BattleEnvironmentRenderer } from "../src/scenes/BattleEnvironmentRenderer";
import { calculateBattleLayout } from "../src/scenes/battleLayout";

it("bakes projected world terrain once across turn updates, replaces it on zoom and releases it on shutdown",()=>{
  const keys=new Set(["environment:meadow-grass","environment:worn-earth","environment:forest-floor"]);
  const setTransform=vi.fn();
  const ctx={scale:vi.fn(),translate:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),save:vi.fn(),restore:vi.fn(),transform:vi.fn(),createPattern:vi.fn(()=>({setTransform})),fillStyle:"",globalAlpha:1};
  const refresh=vi.fn(),remove=vi.fn((key:string)=>keys.delete(key));
  const createCanvas=vi.fn((key:string)=>{keys.add(key);return {getContext:()=>ctx,refresh};});
  const image=()=>({setOrigin(){return this;},setDisplaySize(){return this;},setDepth(){return this;}});
  const scene={textures:{exists:(key:string)=>keys.has(key),get:()=>({getSourceImage:()=>({width:1254,height:1254})}),createCanvas,remove},add:{image}} as unknown as Phaser.Scene;
  const snapshot:BattleSnapshot={id:"battle",round:1,activeCombatantId:"",turnOrder:[],cells:[{q:0,r:0},{q:1,r:0}],blockedCells:[{q:1,r:0}],coverCells:[],combatants:[],finished:false};
  const layout=calculateBattleLayout(1280,800,snapshot.cells,undefined);
  const renderer=new BattleEnvironmentRenderer(scene);
  expect(renderer.render(snapshot,layout,[])).toBe(true);
  expect(ctx.transform).toHaveBeenCalledWith(Math.sqrt(3)/2,0.5,-Math.sqrt(3)/2,0.5,0,0);
  expect(ctx.createPattern).toHaveBeenCalledTimes(3);
  expect(refresh).toHaveBeenCalledOnce();
  renderer.render({...snapshot,round:2},{...layout,centerX:layout.centerX+20},[]);
  expect(createCanvas).toHaveBeenCalledOnce();
  renderer.render(snapshot,{...layout,hexSize:layout.hexSize*1.8},[]);
  expect(createCanvas).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledOnce();
  renderer.destroy();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(keys.has("battle:projected-ground")).toBe(false);
});
