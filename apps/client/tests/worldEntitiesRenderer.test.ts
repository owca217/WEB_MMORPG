import type { WorldPlayerSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {
  Math: { Linear: (start: number, end: number, amount: number) => start + (end - start) * amount }
} }));

import { WorldEntitiesRenderer } from "../src/world/WorldEntitiesRenderer";

class DisplayObject {
  depth = 0;
  destroyed = false;
  parent: DisplayObject | undefined;
  children: DisplayObject[] = [];
  originX = 0;
  originY = 0;

  constructor(public kind: string, public x = 0, public y = 0) {}
  setDepth(depth: number) { this.depth = depth; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }
  setStrokeStyle() { return this; }
  add(objects: DisplayObject | DisplayObject[]) {
    for (const object of Array.isArray(objects) ? objects : [objects]) {
      object.parent = this;
      this.children.push(object);
    }
    return this;
  }
  addAt(object: DisplayObject, index: number) {
    object.parent = this;
    this.children.splice(index, 0, object);
    return this;
  }
  destroy(children = false) {
    this.destroyed = true;
    if (children) for (const child of this.children) child.destroy(true);
  }
  get worldX(): number { return this.x + (this.parent?.worldX ?? 0); }
  get worldY(): number { return this.y + (this.parent?.worldY ?? 0); }
}

class TextObject extends DisplayObject {
  width = 100;
  height = 32;
  constructor(x: number, y: number, public text: string, public style: Phaser.Types.GameObjects.Text.TextStyle) {
    super("text", x, y);
  }
  setText(text: string) { this.text = text; return this; }
}

class GraphicsObject extends DisplayObject {
  fillColor: number | undefined;
  roundedWidth = 0;
  fillStyle(color: number) { this.fillColor = color; return this; }
  lineStyle() { return this; }
  fillRoundedRect(_x: number, _y: number, width: number) { this.roundedWidth = width; return this; }
  strokeRoundedRect() { return this; }
  fillTriangle() { return this; }
}

function createScene() {
  const objects: DisplayObject[] = [];
  const timers: { dueAt: number; removed: boolean; callback: () => void; remove: () => void }[] = [];
  const register = <T extends DisplayObject>(object: T): T => { objects.push(object); return object; };
  const clock = {
    now: 0,
    delayedCall(delay: number, callback: () => void) {
      const timer = { dueAt: clock.now + delay, removed: false, callback,
        remove() { timer.removed = true; } };
      timers.push(timer);
      return timer;
    }
  };
  const scene = {
    time: clock,
    textures: { exists: () => false },
    add: {
      container: (x = 0, y = 0) => register(new DisplayObject("container", x, y)),
      ellipse: (x: number, y: number) => register(new DisplayObject("ellipse", x, y)),
      triangle: (x: number, y: number) => register(new DisplayObject("triangle", x, y)),
      rectangle: (x: number, y: number) => register(new DisplayObject("rectangle", x, y)),
      circle: (x: number, y: number) => register(new DisplayObject("circle", x, y)),
      text: (x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) =>
        register(new TextObject(x, y, text, style)),
      graphics: () => register(new GraphicsObject("graphics"))
    }
  };
  return {
    scene: scene as unknown as Phaser.Scene,
    objects,
    timers,
    advance(milliseconds: number) {
      clock.now += milliseconds;
      for (const timer of timers) {
        if (timer.removed || timer.dueAt > clock.now) continue;
        timer.removed = true;
        timer.callback();
      }
    },
    text(value: string) {
      return objects.find((object): object is TextObject => object instanceof TextObject && object.text === value);
    }
  };
}

const hero: WorldPlayerSnapshot = { id: "hero", nickname: "Bohater", x: 100, y: 200 };
const friend: WorldPlayerSnapshot = { id: "friend", nickname: "Przyjaciel", x: 300, y: 400 };
function snapshot(players: WorldPlayerSnapshot[]): WorldStateSnapshot {
  return { locationId: "forest-settlement", players, npcs: [], encounters: [] };
}

describe("world chat speech bubbles", () => {
  it("draws literal wrapped text above names and follows both local and remote players", () => {
    const fake = createScene();
    const renderer = new WorldEntitiesRenderer(fake.scene, hero.id);
    renderer.render(snapshot([hero, friend]));
    const literal = '<img src=x onerror="alert(1)"> Witaj w osadzie!';
    renderer.showSpeechBubble(hero.id, literal);
    renderer.showSpeechBubble(friend.id, "Cześć!");

    const localText = fake.text(literal)!;
    const remoteText = fake.text("Cześć!")!;
    expect(localText.text).toBe(literal);
    expect(localText.style.wordWrap?.width).toBeLessThanOrEqual(220);
    expect(localText.style.wordWrap?.useAdvancedWrap).toBe(true);
    expect(localText.style.color).toBe("#30271d");
    expect(localText.worldY).toBeLessThan(fake.text(hero.nickname)!.worldY);
    expect(localText.parent!.depth).toBeGreaterThan(fake.text(hero.nickname)!.parent!.depth);
    const background = localText.parent!.children.find((object) => object instanceof GraphicsObject) as GraphicsObject;
    expect(background.fillColor).toBe(0xf5ebca);
    expect(background.roundedWidth).toBeLessThanOrEqual(220);

    const localOffset = localText.worldY - hero.y;
    const remoteOffset = remoteText.worldY - friend.y;
    renderer.setLocalPlayerPosition(160, 250);
    renderer.render(snapshot([hero, { ...friend, x: 340, y: 440 }]));
    renderer.updateRemotePlayers();
    expect(localText.worldX).toBe(160);
    expect(localText.worldY).toBe(250 + localOffset);
    expect(remoteText.worldX).toBe(310);
    expect(remoteText.worldY).toBe(410 + remoteOffset);
  });

  it("replaces a bubble immediately and lets the replacement live for six seconds", () => {
    const fake = createScene();
    const renderer = new WorldEntitiesRenderer(fake.scene, hero.id);
    renderer.render(snapshot([hero]));
    renderer.showSpeechBubble(hero.id, "Pierwsza");
    const first = fake.text("Pierwsza")!;
    fake.advance(3000);
    renderer.showSpeechBubble(hero.id, "Druga");
    const second = fake.text("Druga")!;
    expect(first.destroyed).toBe(true);
    expect(fake.timers[0]!.removed).toBe(true);
    fake.advance(3000);
    expect(second.destroyed).toBe(false);
    fake.advance(2999);
    expect(second.destroyed).toBe(false);
    fake.advance(1);
    expect(second.destroyed).toBe(true);
    expect(second.parent!.destroyed).toBe(true);
  });

  it("holds messages until the player appears without restarting their expiry", () => {
    const fake = createScene();
    const renderer = new WorldEntitiesRenderer(fake.scene, hero.id);
    renderer.showSpeechBubble(friend.id, "Przed światem");
    expect(fake.objects).toHaveLength(0);
    fake.advance(2000);
    renderer.render(snapshot([friend]));
    const text = fake.text("Przed światem")!;
    expect(text.destroyed).toBe(false);
    fake.advance(3999);
    expect(text.destroyed).toBe(false);
    fake.advance(1);
    expect(text.destroyed).toBe(true);
  });

  it("bounds pending speakers, keeps their newest message, and discards expired pending messages", () => {
    const fake = createScene();
    const renderer = new WorldEntitiesRenderer(fake.scene, hero.id);
    for (let index = 0; index < 51; index++) renderer.showSpeechBubble(`speaker-${index}`, `Wiadomość ${index}`);
    renderer.showSpeechBubble("speaker-50", "Najnowsza");
    expect(fake.objects).toHaveLength(0);
    renderer.render(snapshot([
      { ...friend, id: "speaker-0" }, { ...friend, id: "speaker-50" }
    ]));
    expect(fake.text("Wiadomość 0")).toBeUndefined();
    expect(fake.text("Wiadomość 50")).toBeUndefined();
    expect(fake.text("Najnowsza")?.destroyed).toBe(false);
    renderer.showSpeechBubble("late", "Przeterminowana");
    fake.advance(6000);
    renderer.render(snapshot([{ ...friend, id: "late" }]));
    expect(fake.text("Przeterminowana")).toBeUndefined();
  });

  it("cleans bubbles and timers on player removal and renderer destruction", () => {
    const fake = createScene();
    const renderer = new WorldEntitiesRenderer(fake.scene, hero.id);
    renderer.render(snapshot([hero, friend]));
    renderer.showSpeechBubble(hero.id, "Moja");
    renderer.showSpeechBubble(friend.id, "Sąsiada");
    renderer.showSpeechBubble("pending", "Oczekująca");
    renderer.render(snapshot([hero]));
    expect(fake.text("Sąsiada")?.destroyed).toBe(true);
    expect(fake.timers[1]!.removed).toBe(true);
    expect(fake.text("Moja")?.destroyed).toBe(false);
    renderer.destroy();
    expect(fake.text("Moja")?.destroyed).toBe(true);
    expect(fake.timers.every((timer) => timer.removed)).toBe(true);
    expect(fake.objects.every((object) => object.destroyed)).toBe(true);
    renderer.render(snapshot([{ ...friend, id: "pending" }]));
    expect(fake.text("Oczekująca")).toBeUndefined();
  });
});
