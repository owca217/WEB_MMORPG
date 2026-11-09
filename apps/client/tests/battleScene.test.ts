/* @vitest-environment jsdom */

import { EventEmitter } from "node:events";
import type { BattleSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phaser rendering requires a browser canvas; the scene and DOM HUD stay real.
vi.mock("phaser", () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
    Math: {
      DegToRad: (degrees: number) => degrees * Math.PI / 180,
      Vector2: class { constructor(readonly x: number, readonly y: number) {} }
    },
    Geom: { Polygon: class {
      static Contains() { return true; }
      constructor(readonly points: Array<{ x: number; y: number }>) {}
    } }
  }
}));

import { gameSocket, type BattleEndedPayload } from "../src/net/GameSocket";
import { BattleScene } from "../src/scenes/BattleScene";
import { playerStateStore } from "../src/state/PlayerStateStore";

const initialBattle: BattleSnapshot = {
  id: "battle:hero:wolf-pack-01",
  round: 1,
  activeCombatantId: "hero:character-1",
  turnOrder: ["hero:character-1"],
  cells: [],
  blockedCells: [],
  coverCells: [],
  combatants: [{
    id: "hero:character-1",
    ownerPlayerId: "character-1",
    name: "Hero",
    hp: 100,
    maxHp: 100,
    ap: 5,
    maxAp: 5,
    initiative: 10,
    position: { q: 0, r: 0 },
    severelyInjured: false,
    injuries: []
  }],
  finished: false
};

function createScene(snapshot = initialBattle, width = 800, height = 600, loadedAssetIds: string[] = []) {
  const scene = new BattleScene();
  const events = new EventEmitter();
  const start = vi.fn(() => events.emit("shutdown"));
  const scaleEvents = new EventEmitter();
  const polygons: Array<Array<{ x: number; y: number }>> = [];
  const zones: Array<{ x: number; y: number; width: number; height: number; handlers: Map<string, (pointer?: {wasTouch:boolean}) => void> }> = [];
  const bodies: Array<{ x: number; y: number; radius: number; fill:number; inputCalls:unknown[] }> = [];
  const captions: string[] = [];
  const drawable = () => ({
    displayWidth: 0, displayHeight: 0, alpha: 1, tint: undefined as number | undefined, depth: 0,
    handlers: new Map<string, (pointer?: {wasTouch:boolean}) => void>(),
    inputCalls: [] as unknown[],
    width: 80,
    height: 16,
    destroy() {},
    setOrigin() { return this; },
    setPosition() { return this; },
    setDepth(depth:number) { this.depth=depth;return this; },
    setStrokeStyle() { return this; },
    setInteractive(config?:unknown) { this.inputCalls.push(config);return this; },
    on(event: string, handler: (pointer?: {wasTouch:boolean}) => void) { this.handlers.set(event,handler); return this; },
    setDisplaySize(width:number,height:number) { this.displayWidth=width;this.displayHeight=height;return this; },
    setAlpha(alpha:number) { this.alpha=alpha;return this; },
    setTint(tint:number) { this.tint=tint;return this; },
    clear() { return this; },
    lineStyle() { return this; },
    fillStyle() { return this; },
    fillPoints() {},
    fillCircle() {},
    fillEllipse() { return this; },
    strokeEllipse() { return this; },
    fillRect() { return this; },
    fillRoundedRect() {},
    strokePoints(points: Array<{ x: number; y: number }>) { polygons.push(points); }
  });
  const sprites: Array<ReturnType<typeof drawable> & { x:number;y:number;key:string;frame:string|number|undefined }> = [];
  const images: typeof sprites = [];
  const image=vi.fn();
  const scale = Object.assign(scaleEvents, { width, height });

  Object.assign(scene, {
    cameras: { main: { setBackgroundColor() {}, setViewport: vi.fn(), centerX: width / 2, centerY: height / 2, width, height } },
    scale,
    load:{image},textures:{exists:(key:string)=>loadedAssetIds.some(id=>key===id || key===`enemy-skin:${id}`),get:()=>({has:()=>true,setFilter(){},add:()=>({setTrim(){}})})},
    anims:{exists:()=>true},
    add: {
      graphics: drawable,
      circle: (x: number, y: number, radius: number, fill:number) => { const body=drawable();bodies.push({ x, y, radius, fill, inputCalls:body.inputCalls }); return body; },
      text:(_x:number,_y:number,caption:string)=>{captions.push(caption);return drawable();},
      sprite:(x:number,y:number,key:string,frame?:string|number)=>{const sprite={...drawable(),x,y,key,frame};sprites.push(sprite);return sprite;},
      image:(x:number,y:number,key:string,frame?:string|number)=>{const image={...drawable(),x,y,key,frame};images.push(image);return image;},
      zone: (x: number, y: number, zoneWidth: number, zoneHeight: number) => {
        const zone = { x, y, width: zoneWidth, height: zoneHeight, handlers: new Map<string, (pointer?: {wasTouch:boolean}) => void>() };
        zones.push(zone);
        return { ...drawable(), on(event: string, handler: () => void) { zone.handlers.set(event, handler); return this; } };
      }
    },
    events,
    scene: { start }
  });
  scene.init({ playerId: "character-1", snapshot });
  scene.create();
  return { scene, events, start, scale, polygons, zones, bodies, sprites, images, image, captions };
}

describe("BattleScene completion", () => {
  it.each(["male-traveler","male-scout","male-guard","female-traveler","female-scout","female-guard"] as const)("uses the selected %s skin in battle and the ally's own skin",skinId=>{
    const own={...initialBattle.combatants[0]!,side:"player" as const,skinId};
    const ally={...own,id:"hero:ally",ownerPlayerId:"ally",skinId:"female-scout" as const,position:{q:1,r:0}};
    const {events,sprites,bodies}=createScene({...initialBattle,cells:[own.position,ally.position],combatants:[own,ally]},1280,800,[`character-skin:${skinId}`,"character-skin:female-scout"]);
    expect(sprites.map(sprite=>sprite.key)).toEqual([`character-skin:${skinId}`,"character-skin:female-scout"]);
    expect(sprites[0]!.frame).toBe("battle:east");
    expect(sprites[0]!.displayHeight).toBeGreaterThan(50);
    expect(sprites[1]!.depth).toBeGreaterThan(sprites[0]!.depth);
    expect(bodies).toHaveLength(0);
    events.emit("shutdown");
  });

  it("uses the world wolf texture for legacy wolf ids and preserves its touch selection",()=>{
    const wolf={...initialBattle.combatants[0]!,id:"wolf:pack:0",ownerPlayerId:"wolf",name:"Wilk",position:{q:1,r:0}};
    const {events,sprites,captions}=createScene({...initialBattle,cells:[{q:0,r:0},wolf.position],combatants:[...initialBattle.combatants,wolf]},420,700,["forest-wolf"]);
    expect(sprites).toHaveLength(1);expect(sprites[0]!.key).toBe("enemy-skin:forest-wolf");
    expect(captions.at(-1)).toBe(wolf.name);
    const commands:unknown[]=[];transport.on("battleCommand",value=>commands.push(value));
    sprites[0]!.handlers.get("pointerup")!({wasTouch:true});
    expect(commands).toEqual([]);expect(document.querySelector("[data-attack-preview]")?.textContent).toContain("Wilk");
    events.emit("shutdown");
  });

  it("recovers only the owner's appearance from older snapshots and preserves the ally's default",()=>{
    playerStateStore.set({character:{playerId:"character-1",nickname:"Hero",appearance:{skinId:"female-guard"},level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]},inventory:{items:[]}});
    const own={...initialBattle.combatants[0]!,side:"player" as const};
    const ally={...own,id:"hero:ally",ownerPlayerId:"ally",position:{q:1,r:0}};
    const {events,sprites}=createScene({...initialBattle,cells:[own.position,ally.position],combatants:[own,ally]},1280,800,["character-skin:female-guard","character-skin:male-traveler"]);
    expect(sprites.map(sprite=>sprite.key)).toEqual(["character-skin:female-guard","character-skin:male-traveler"]);
    transport.emit("playerState",{character:{...playerStateStore.get()!.character,appearance:{skinId:"male-traveler"}},inventory:{items:[]}});
    expect(sprites.at(-2)!.key).toBe("character-skin:male-traveler");
    events.emit("shutdown");
  });

  it("sorts generated obstacles with the units by ground position and keeps blocked cells noninteractive",()=>{
    const cells=[{q:0,r:0},{q:1,r:0},{q:2,r:0}];
    const own={...initialBattle.combatants[0]!,skinId:"male-scout" as const,position:cells[1]!};
    const {events,images,sprites,zones}=createScene({...initialBattle,cells,blockedCells:[cells[0]!],coverCells:[cells[2]!],combatants:[own]},1280,800,["character-skin:male-scout","battle-prop:mossy-rocks","battle-prop:fallen-log"]);
    expect(images.map(image=>image.key)).toEqual(["battle-prop:mossy-rocks","battle-prop:fallen-log"]);
    expect(images.every(image=>image.frame==="prop")).toBe(true);
    expect(images[0]!.depth).toBeLessThan(sprites[0]!.depth);
    expect(images[1]!.depth).toBeGreaterThan(sprites[0]!.depth);
    expect(zones).toHaveLength(2);
    events.emit("shutdown");
  });
  it("sends a learned technique once through the dock and waits for the server",()=>{
    const hero={...initialBattle.combatants[0]!,side:"player" as const,weaponSkills:["sword:power" as const],combatStats:{meleeDamage:30,rangedDamage:0,armor:0}};
    const enemy:BattleSnapshot["combatants"][number]={...hero,id:"wolf",side:"enemy",name:"Wilk",position:{q:1,r:0},weaponSkills:[]};
    delete enemy.ownerPlayerId;
    const {events}=createScene({...initialBattle,combatants:[hero,enemy],cells:[{q:0,r:0},{q:1,r:0}]});
    const commands:unknown[]=[];transport.on("battleCommand",command=>commands.push(command));
    document.querySelector<HTMLButtonElement>('[data-toggle-skills]')!.click();
    document.querySelector<HTMLButtonElement>('[data-use-weapon-skill]')!.click();
    document.querySelector<HTMLButtonElement>('[data-use-weapon-skill]')!.click();
    expect(commands).toEqual([{type:"useWeaponSkill",combatantId:hero.id,skillId:"sword:power",targetId:enemy.id}]);
    expect(document.querySelector<HTMLButtonElement>('[data-use-weapon-skill]')!.disabled).toBe(true);events.emit("shutdown");
  });
  it("loads enemy art on direct battle entry and keeps sprites inside phone hexes with active interactions and dead state", () => {
    const enemy={...initialBattle.combatants[0]!,id:"forest-bandit-01",ownerPlayerId:"enemy",name:"Bandyta",enemyId:"forest-bandit" as const,position:{q:1,r:0}};
    const snapshot={...initialBattle,cells:[{q:0,r:0},{q:1,r:0}],combatants:[...initialBattle.combatants,enemy]};
    const {scene,events,sprites,bodies,zones,image,captions}=createScene(snapshot,420,700,["forest-bandit"]);
    scene.preload();
    expect(image.mock.calls.map(call=>call[0])).toEqual(expect.arrayContaining(["enemy-skin:feral-rat","character-skin:male-traveler","character-skin:female-guard","environment:meadow-grass","environment:forest-floor","battle-prop:mossy-rocks","battle-prop:fallen-log"]));
    expect(image.mock.calls.map(call=>call[0])).not.toContain("enemy-skin:forest-bandit");
    expect(sprites).toHaveLength(1);
    const sprite=sprites[0]!;
    expect(sprite.key).toBe("enemy-skin:forest-bandit");
    const zone=zones[1]!;
    expect(sprite.displayWidth).toBeLessThanOrEqual(zone.width);
    expect(sprite.displayHeight).toBeLessThanOrEqual(zone.height*1.5);
    expect(sprite.displayHeight).toBeGreaterThan(0);
    expect(sprite.inputCalls).toEqual([{useHandCursor:true,pixelPerfect:true,alphaTolerance:16}]);
    expect(bodies).toHaveLength(1);
    expect(captions.at(-1)).toContain("poz. 7");
    const commands:unknown[]=[];transport.on("battleCommand",command=>commands.push(command));
    sprite.handlers.get("pointerup")!({wasTouch:true});
    expect(commands).toHaveLength(0);
    expect(document.querySelector("[data-attack-preview]")?.textContent).toContain(enemy.name);
    transport.emit("battleState",{...snapshot,combatants:[...initialBattle.combatants,{...enemy,hp:0}]});
    const deadSprite=sprites.at(-1)!;
    expect(deadSprite.alpha).toBeLessThan(0.6);
    expect(deadSprite.tint).toBeDefined();
    expect(deadSprite.inputCalls).toEqual([]);
    expect(deadSprite.handlers.has("pointerup")).toBe(false);
    expect(commands).toHaveLength(0);
    events.emit("shutdown");
  });

  it("preserves visible circles when a new enemy sprite is unavailable", () => {
    const enemy={...initialBattle.combatants[0]!,id:"rat",ownerPlayerId:"enemy",name:"Szczur",enemyId:"feral-rat" as const,position:{q:1,r:0}};
    const {events,sprites,bodies}=createScene({...initialBattle,combatants:[...initialBattle.combatants,enemy]});
    expect(sprites).toHaveLength(0);
    expect(bodies).toHaveLength(2);
    events.emit("shutdown");
  });

  it("keeps unavailable dead art visible without giving its fallback body an input area",()=>{
    const dead={...initialBattle.combatants[0]!,id:"wolf:dead",ownerPlayerId:"enemy",hp:0,position:{q:1,r:0}};
    const {events,bodies}=createScene({...initialBattle,cells:[{q:0,r:0},dead.position],combatants:[...initialBattle.combatants,dead]});
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.inputCalls).toHaveLength(1);
    expect(bodies[1]!.inputCalls).toEqual([]);
    events.emit("shutdown");
  });

  it.each(["victory", "defeat"] as const)(
    "returns to the world after the server confirms %s",
    (outcome) => {
      const { start } = createScene();
      expect(document.querySelector(".battle-hud")).not.toBeNull();

      transport.emit("battleState", { ...initialBattle, finished: true });
      expect(start).not.toHaveBeenCalled();

      const completed: BattleEndedPayload = {
        outcome,
        inventory: { items: [] },
        character: {
          playerId: "character-1",
          nickname: "Hero",
          level: 1,
          hp: outcome === "victory" ? 71 : 25,
          maxHp: 100,
          maxAp: 5,
          initiative: 10,
          severelyInjured: outcome === "defeat",
          injuries: outcome === "defeat" ? ["legTrauma"] : []
        }
      };
      transport.emit("battleEnded", completed);

      expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", {
        playerId: "character-1",
        battleResult: { outcome, experienceGained: 0, levelsGained: 0, level: 1 }
      });
      expect(document.querySelector(".battle-hud")).toBeNull();

      // A completed scene must not react again while another scene is active.
      transport.emit("battleEnded", completed);
      expect(start).toHaveBeenCalledTimes(1);
    }
  );

  let transport: EventEmitter;

  it("zooms graphics and hit cells together, resets to fit and reserves the full battle canvas", () => {
    const cells = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
    const { scene, events, scale, zones, polygons } = createScene({ ...initialBattle, cells }, 844, 390);
    expect(scene.cameras.main.setViewport).toHaveBeenLastCalledWith(0, 0, 844, 390);
    const size = zones[0]!.width;
    const edge = Math.hypot(polygons[0]![0]!.x - polygons[0]![1]!.x, polygons[0]![0]!.y - polygons[0]![1]!.y);
    const zoom = document.querySelector<HTMLButtonElement>("[data-toggle-battle-zoom]")!;
    zoom.click();
    expect(zoom.getAttribute("aria-pressed")).toBe("true");
    expect(zones.at(-2)!.width / size).toBeCloseTo(1.8);
    const enlarged = polygons.at(-2)!;
    const enlargedEdge = Math.hypot(enlarged[0]!.x - enlarged[1]!.x, enlarged[0]!.y - enlarged[1]!.y);
    // The raised tile edge uses a one-pixel inset at both scales.
    expect(enlargedEdge).toBeGreaterThan(edge * 1.7);
    zoom.click();
    expect(zones.at(-2)!.width).toBeCloseTo(size);
    zoom.click();
    scale.width = 1280; scale.height = 720; scale.emit("resize");
    expect(zoom.getAttribute("aria-pressed")).toBe("false");
    expect(scene.cameras.main.setViewport).toHaveBeenLastCalledWith(0, 0, 1280, 720);
    events.emit("shutdown");
    expect(document.querySelector("[data-battle-actions]")).toBeNull();
  });

  it("returns to the world after reconnecting an abandoned automatic battle and removes the reconnect listener",()=>{
    let reauthenticated!:(result:{ok:true;characterId:string;locationId:string})=>void;
    const unsubscribe=vi.fn();
    vi.spyOn(gameSocket,"onReauthenticated").mockImplementation(handler=>{reauthenticated=handler;return unsubscribe;});
    const {start}=createScene({...initialBattle,autoBattle:true});
    reauthenticated({ok:true,characterId:"character-1",locationId:"forest-settlement-01"});
    expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene",{playerId:"character-1"});
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("blocks manual actions during auto and resumes only after the server confirms takeover",async()=>{
    const takeover=vi.spyOn(gameSocket,"setBattleAuto");
    let acknowledge!:(value:unknown)=>void;
    takeover.mockImplementation(()=>new Promise(resolve=>{acknowledge=resolve as typeof acknowledge;}));
    const commands:unknown[]=[];transport.on("battleCommand",command=>commands.push(command));
    const enemy={...initialBattle.combatants[0]!,id:"wolf",ownerPlayerId:"enemy",name:"Wilk",position:{q:1,r:0}};
    const {events,zones}=createScene({...initialBattle,autoBattle:true,cells:[{q:0,r:0},{q:1,r:0}],combatants:[...initialBattle.combatants,enemy]});
    zones[1]!.handlers.get("pointerup")!();
    expect(commands).toEqual([]);
    document.querySelector<HTMLButtonElement>('[data-action="auto"]')!.click();
    expect(takeover).toHaveBeenCalledWith(false);
    expect(document.querySelector<HTMLButtonElement>('[data-action="end"]')!.disabled).toBe(true);
    acknowledge({ok:true,snapshot:{...initialBattle,cells:[{q:0,r:0},{q:1,r:0}],combatants:[...initialBattle.combatants,enemy]}});
    await vi.waitFor(()=>expect(document.querySelector<HTMLButtonElement>('[data-action="end"]')!.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('[data-action="end"]')!.click();expect(commands).toHaveLength(1);
    events.emit("shutdown");
  });

  it("sends one staff heal command and disables it after acknowledged use or while auto controls combat",()=>{
    const commands:unknown[]=[];transport.on("battleCommand",value=>commands.push(value));
    const actor={...initialBattle.combatants[0]!,hp:50,combatStats:{meleeDamage:20,rangedDamage:15,armor:0,healingPower:20,blockPercent:10}};
    const battle={...initialBattle,combatants:[actor]};const {events}=createScene(battle);
    const heal=document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')!;
    expect(document.querySelector("[data-healing-power]")?.textContent).toBe("20 HP");
    expect(document.querySelector("[data-shield-block]")?.textContent).toContain("10%");
    expect(heal.hidden).toBe(false);expect(heal.disabled).toBe(false);heal.click();heal.click();
    expect(commands).toEqual([{type:"healSelf",combatantId:actor.id}]);
    transport.emit("battleState",{...battle,combatants:[{...actor,hp:70,ap:2,healingUsedThisTurn:true}]});
    expect(document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')?.disabled).toBe(true);events.emit("shutdown");
    const automatic=createScene({...battle,autoBattle:true});
    expect(document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')?.disabled).toBe(true);automatic.events.emit("shutdown");
  });

  it("distinguishes party allies, keeps own stats during their turn and heals the explicitly selected ally",()=>{
    const commands:unknown[]=[];transport.on("battleCommand",command=>commands.push(command));
    const own={...initialBattle.combatants[0]!,side:"player" as const,combatStats:{meleeDamage:20,rangedDamage:15,armor:0,healingPower:20}};
    const ally={...own,id:"hero:ally",ownerPlayerId:"ally",name:"Borys",hp:40,position:{q:1,r:0}};
    const enemy={...own,id:"wolf",side:"enemy" as const,name:"Wilk",position:{q:2,r:0}};delete enemy.ownerPlayerId;
    const snapshot={...initialBattle,cells:[own.position,ally.position,enemy.position],combatants:[own,ally,enemy]};
    const {events,zones,bodies}=createScene(snapshot);
    expect(bodies.map(body=>body.fill)).toEqual([0x5fa6e8,0x6fac75,0xcf6a61]);
    expect(document.querySelector('[data-team-member="hero:ally"]')?.textContent).toContain("Borys");
    zones[1]!.handlers.get("pointerup")!({wasTouch:true});
    expect(commands).toEqual([]);expect(document.querySelector<HTMLButtonElement>('[data-confirm-attack]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('[data-battle-healing-target]')?.value).toBe(ally.id);
    let select=document.querySelector<HTMLSelectElement>('[data-battle-healing-target]')!;select.value=own.id;select.dispatchEvent(new Event("change",{bubbles:true}));
    expect(document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')?.disabled).toBe(true);
    select=document.querySelector<HTMLSelectElement>('[data-battle-healing-target]')!;select.value=ally.id;select.dispatchEvent(new Event("change",{bubbles:true}));
    document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')!.click();
    expect(commands).toEqual([{type:"healAlly",combatantId:own.id,targetId:ally.id}]);
    transport.emit("battleState",{...snapshot,activeCombatantId:ally.id,combatants:[own,{...ally,hp:60},enemy]});
    expect(document.querySelector('[data-name]')?.textContent).toBe("Hero");
    expect(document.querySelector('[data-hp]')?.textContent).toBe("100/100");
    expect(document.querySelector('[data-turn-status]')?.textContent).toContain("Borys");
    expect(document.querySelector('[data-team-member="hero:ally"]')?.getAttribute("data-active")).toBe("true");
    expect(document.querySelector<HTMLButtonElement>('[data-action="heal-self"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-action="end"]')?.disabled).toBe(true);
    expect(document.querySelector('[data-action="auto"]')?.textContent).toBe("Włącz auto");
    transport.emit("battleState",{...snapshot,activeCombatantId:ally.id,autoBattle:true});
    expect(document.querySelector('[data-action="auto"]')?.textContent).toBe("Przejmij sterowanie");
    events.emit("shutdown");
  });

  beforeEach(() => {
    document.body.replaceChildren();
    transport = new EventEmitter();
    vi.spyOn(gameSocket, "connect").mockReturnValue(
      transport as unknown as ReturnType<typeof gameSocket.connect>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it.each(["victory", "defeat"] as const)(
    "returns to the world after the server confirms %s",
    (outcome) => {
      const { start } = createScene();
      expect(document.querySelector(".battle-hud")).not.toBeNull();

      transport.emit("battleState", { ...initialBattle, finished: true });
      expect(start).not.toHaveBeenCalled();

      const completed: BattleEndedPayload = {
        outcome,
        inventory: { items: [] },
        character: {
          playerId: "character-1",
          nickname: "Hero",
          level: 1,
          hp: outcome === "victory" ? 71 : 25,
          maxHp: 100,
          maxAp: 5,
          initiative: 10,
          severelyInjured: outcome === "defeat",
          injuries: outcome === "defeat" ? ["legTrauma"] : []
        }
      };
      transport.emit("battleEnded", completed);

      expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", {
        playerId: "character-1",
        battleResult: { outcome, experienceGained: 0, levelsGained: 0, level: 1 }
      });
      expect(document.querySelector(".battle-hud")).toBeNull();

      // A completed scene must not react again while another scene is active.
      transport.emit("battleEnded", completed);
      expect(start).toHaveBeenCalledTimes(1);
    }
  );

  it("carries awarded XP and the final level into the world without retaining battle listeners", () => {
    const { start } = createScene();
    transport.emit("battleEnded", {
      outcome: "victory", experienceGained: 80, levelsGained: 1,
      inventory: { items: [] },
      character: {
        playerId: "character-1", nickname: "Hero", level: 2, experience: 150,
        hp: 101, maxHp: 130, maxAp: 5, initiative: 10,
        severelyInjured: false, injuries: []
      }
    } satisfies BattleEndedPayload);

    expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", {
      playerId: "character-1",
      battleResult: { outcome: "victory", experienceGained: 80, levelsGained: 1, level: 2 }
    });
    expect(transport.listenerCount("battleEnded")).toBe(0);
    expect(transport.listenerCount("battleState")).toBe(0);
    const next = createScene();
    expect(transport.listenerCount("battleEnded")).toBe(1);
    next.events.emit("shutdown");
    expect(transport.listenerCount("battleEnded")).toBe(0);
  });

  it("fits every cell and combatant between phone header and dock and recalculates on resize", () => {
    const cells = [];
    for (let q = -4; q <= 4; q += 1) {
      for (let r = -4; r <= 4; r += 1) {
        if (Math.abs(q + r) <= 4) cells.push({ q, r });
      }
    }
    let viewportHeight = 380;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.hasAttribute("data-battle-header")
        ? { x: 12, y: 12, width: 816, height: 96 }
        : this.hasAttribute("data-battle-actions") ? { x: 12, y: viewportHeight - 88, width: 816, height: 76 } : {});
    });
    const battle = { ...initialBattle, cells };
    const { events, polygons, bodies, zones, scale } = createScene(battle, 840, 380);
    const assertArenaFits = () => {
      const points = polygons.slice(-61).flat();
      expect(points).toHaveLength(366);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(12);
        expect(point.x).toBeLessThanOrEqual(828);
        expect(point.y).toBeGreaterThanOrEqual(120);
        expect(point.y).toBeLessThanOrEqual(viewportHeight - 100);
      }
    };
    assertArenaFits();
    expect(bodies).toHaveLength(battle.combatants.length);
    expect(zones).toHaveLength(61);
    expect(bodies[0]!.radius).toBeGreaterThanOrEqual(4);

    const fittedZoneWidth = zones[0]!.width;
    polygons.length = 0;
    scale.height = 340;
    viewportHeight = 340;
    scale.emit("resize");
    assertArenaFits();
    expect(zones.at(-61)!.width).toBeLessThan(fittedZoneWidth);
    expect(Math.max(...polygons.flat().map((point) => point.y))).toBeLessThanOrEqual(328);
    events.emit("shutdown");
    expect(scale.listenerCount("resize")).toBe(0);
  });

  it("previews an automatic melee attack on hover and attacks through its whole projected hex", () => {
    const enemy = { ...initialBattle.combatants[0]!, id: "wolf", ownerPlayerId: "wolf", name: "Wilk", position: { q: 1, r: 0 } };
    const { events, zones } = createScene({ ...initialBattle, cells: [{ q: 1, r: 0 }], combatants: [...initialBattle.combatants, enemy] });
    const commands: unknown[] = [];
    transport.on("battleCommand", (command) => commands.push(command));
    expect(document.querySelector("[data-action='melee']")).toBeNull();
    zones[0]!.handlers.get("pointerover")!();
    expect(document.querySelector("[data-attack-preview]")?.textContent).toContain("100%");
    expect(document.querySelector("[data-attack-preview]")?.textContent).toContain("20");
    zones[0]!.handlers.get("pointerup")!();
    expect(commands).toEqual([{ type: "meleeAttack", combatantId: "hero:character-1", targetId: "wolf" }]);
    events.emit("shutdown");
    expect(document.querySelector("[data-attack-preview]")).toBeNull();
  });

  it("requires confirmation after touch selection and refreshes a distant attack when AP changes", () => {
    const enemy = { ...initialBattle.combatants[0]!, id:"wolf", ownerPlayerId:"enemy", name:"Wilk", position:{q:3,r:0} };
    const snapshot={...initialBattle,cells:[{q:0,r:0},{q:3,r:0}],combatants:[...initialBattle.combatants,enemy]};
    const {events,zones}=createScene(snapshot);
    const commands: unknown[]=[];
    transport.on("battleCommand",command=>commands.push(command));
    zones[1]!.handlers.get("pointerup")!({wasTouch:true});
    expect(commands).toEqual([]);
    expect(document.querySelector("[data-attack-preview]")?.textContent).toContain("Atak dystansowy");
    document.querySelector<HTMLButtonElement>("[data-confirm-attack]")!.click();
    expect(commands).toEqual([{type:"rangedAttack",combatantId:"hero:character-1",targetId:"wolf"}]);
    transport.emit("battleState",{...snapshot,combatants:[{...initialBattle.combatants[0]!,ap:0},enemy]});
    const button=document.querySelector<HTMLButtonElement>("[data-confirm-attack]");
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(commands).toHaveLength(1);
    events.emit("shutdown");
  });

  it("does not send movement for occupied, blocked or unreachable tiles", () => {
    const {events,zones}=createScene({...initialBattle,cells:[{q:0,r:0},{q:1,r:0},{q:2,r:0}],
      blockedCells:[{q:1,r:0}],combatants:[{...initialBattle.combatants[0]!,ap:1}]});
    const commands: unknown[]=[]; transport.on("battleCommand",command=>commands.push(command));
    for(const zone of zones) zone.handlers.get("pointerup")!();
    expect(commands).toEqual([]);
    events.emit("shutdown");
  });

  it("uses the selected own item through the socket and keeps the stored inventory authoritative", async () => {
    const battle = {...initialBattle,combatants:[{...initialBattle.combatants[0]!,hp:61}]};
    const {events}=createScene(battle);
    const bandage={instanceId:"bandage",itemId:"field-bandage",itemDefinitionId:"def",name:"Bandaż",category:"consumable",
      description:"",rarity:"COMMON" as const,quantity:3,upgradeLevel:0,consumableEffects:{healHp:30}};
    const character={playerId:"character-1",nickname:"Hero",level:1,hp:61,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
    transport.emit("playerState",{character,inventory:{items:[bandage]}});
    let acknowledge!: (value:unknown)=>void;
    const emitWithAck=vi.fn(()=>new Promise(resolve=>{acknowledge=resolve;}));
    Object.assign(transport,{timeout:()=>({emitWithAck})});
    document.querySelector<HTMLButtonElement>('[data-use-item="bandage"]')!.click();
    expect(emitWithAck).toHaveBeenCalledWith("useBattleItem",{combatantId:"hero:character-1",itemInstanceId:"bandage"});
    expect(document.querySelector('[data-item-instance-id="bandage"]')?.textContent).toContain("×3");
    transport.emit("battleState",{...battle,combatants:[{...battle.combatants[0]!,hp:91,ap:3}]});
    acknowledge({ok:true,inventory:{items:[{...bandage,quantity:2}]}});
    await vi.waitFor(()=>expect(document.querySelector('[data-item-instance-id="bandage"]')?.textContent).toContain("×2"));
    expect(playerStateStore.get()?.inventory.items[0]?.quantity).toBe(2);
    expect(document.querySelector("[data-hp]")?.textContent).toBe("91/100");
    events.emit("shutdown");
    expect(transport.listenerCount("playerState")).toBe(0);
  });
});
