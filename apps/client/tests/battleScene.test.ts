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

function createScene(snapshot = initialBattle, width = 800, height = 600) {
  const scene = new BattleScene();
  const events = new EventEmitter();
  const start = vi.fn(() => events.emit("shutdown"));
  const scaleEvents = new EventEmitter();
  const polygons: Array<Array<{ x: number; y: number }>> = [];
  const zones: Array<{ x: number; y: number; width: number; height: number; handlers: Map<string, (pointer?: {wasTouch:boolean}) => void> }> = [];
  const bodies: Array<{ x: number; y: number; radius: number }> = [];
  const drawable = () => ({
    width: 80,
    height: 16,
    destroy() {},
    setOrigin() { return this; },
    setPosition() { return this; },
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { return this; },
    on() { return this; },
    lineStyle() {},
    fillStyle() {},
    fillPoints() {},
    fillCircle() {},
    fillRoundedRect() {},
    strokePoints(points: Array<{ x: number; y: number }>) { polygons.push(points); }
  });
  const scale = Object.assign(scaleEvents, { width, height });

  Object.assign(scene, {
    cameras: { main: { setBackgroundColor() {}, centerX: width / 2, centerY: height / 2, width, height } },
    scale,
    add: {
      graphics: drawable,
      circle: (x: number, y: number, radius: number) => { bodies.push({ x, y, radius }); return drawable(); },
      text: drawable,
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
  return { scene, events, start, scale, polygons, zones, bodies };
}

describe("BattleScene completion", () => {
  let transport: EventEmitter;

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

  it("fits every cell and combatant beside a phone HUD and recalculates on resize", () => {
    const cells = [];
    for (let q = -4; q <= 4; q += 1) {
      for (let r = -4; r <= 4; r += 1) {
        if (Math.abs(q + r) <= 4) cells.push({ q, r });
      }
    }
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.classList.contains("battle-hud")
        ? { x: 12, y: 12, width: 220, height: 356 }
        : {});
    });
    const battle = { ...initialBattle, cells };
    const { events, polygons, bodies, zones, scale } = createScene(battle, 840, 380);
    const assertArenaFits = () => {
      const points = polygons.slice(-61).flat();
      expect(points).toHaveLength(366);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(244);
        expect(point.x).toBeLessThanOrEqual(828);
        expect(point.y).toBeGreaterThanOrEqual(12);
        expect(point.y).toBeLessThanOrEqual(368);
      }
    };
    assertArenaFits();
    expect(bodies).toHaveLength(battle.combatants.length);
    expect(zones).toHaveLength(61);
    expect(bodies[0]!.radius).toBeGreaterThanOrEqual(7);

    polygons.length = 0;
    scale.height = 340;
    scale.emit("resize");
    assertArenaFits();
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
