import type { AppearanceSelection } from "@web-mmorpg/shared";
import atlas from "./walkAtlas.json";
import { appearanceVisuals } from "./appearanceVisuals";
import { SPRITE_HEIGHT, SPRITE_WIDTH, spriteHeadIndex } from "./characterSprites";
import { drawEyes } from "./drawCharacterSprite";
import { WALK_DIRECTIONS, type WalkDirection } from "./walkAnimation";

export const WALK_SHEETS = atlas.characters.map(character => ({
  key: `character-walk-${character.id}`,
  url: `${import.meta.env.BASE_URL}assets/characters/walk/${character.image}`
}));
export const WALK_FRAME_NAMES = WALK_DIRECTIONS.flatMap(direction => [0, 1, 2].map(frame => `${direction}-${frame}`));
export const WALK_ATLAS_WIDTH = SPRITE_WIDTH * 3;
export const WALK_ATLAS_HEIGHT = SPRITE_HEIGHT * 8;

type SourceFrame = typeof atlas.characters[0]["frames"]["south-0"];
type RGB = readonly [number, number, number];
const SKIN: readonly RGB[] = [[255, 181, 136], [231, 150, 76], [255, 185, 142], [191, 124, 72]];
const HAIR: readonly RGB[] = [[136, 75, 45], [63, 62, 66], [171, 72, 37], [190, 184, 188]];
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function canvas(): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = SPRITE_WIDTH; result.height = SPRITE_HEIGHT;
  result.getContext("2d", { willReadFrequently: true });
  return result;
}

let imagesPromise: Promise<HTMLImageElement[]> | undefined;
export function loadWalkSheets(): Promise<HTMLImageElement[]> {
  return imagesPromise ??= Promise.all(WALK_SHEETS.map(sheet => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nie udało się wczytać animacji postaci."));
    image.src = sheet.url;
  }))).catch(error => { imagesPromise = undefined; throw error; });
}

/** Normalize each hand-measured cell to a common neck and feet baseline. */
function drawLayer(
  ctx: CanvasRenderingContext2D, images: readonly HTMLImageElement[], index: number,
  frameName: string, head: boolean, selection: AppearanceSelection, mirror: boolean
): void {
  const frame = (atlas.characters[index]!.frames as Record<string, SourceFrame>)[frameName]!;
  const layer = canvas(), c = layer.getContext("2d")!;
  const from = head ? frame.top : frame.neckY;
  const height = head ? frame.neckY - from : frame.pivotY - from;
  const targetY = head ? 2 : 48, targetHeight = head ? 47 : 59;
  const scale = targetHeight / height;
  c.imageSmoothingEnabled = false;
  if (mirror) { c.translate(SPRITE_WIDTH, 0); c.scale(-1, 1); }
  c.drawImage(images[index]!, frame.x, frame.y + from, frame.width, height,
    32 - frame.pivotX * scale, targetY, frame.width * scale, targetHeight);
  const pixels = c.getImageData(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT), data = pixels.data;
  const visual = appearanceVisuals(selection), skin = rgb(visual.skin), hair = rgb(visual.hairColor);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3]! < 180) { data[p + 3] = 0; continue; }
    data[p + 3] = 255;
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    if (Math.max(r, g, b) < 38) continue;
    const y = Math.floor(p / (4 * SPRITE_WIDTH));
    const skinPixel = r > g * 1.12 && g > b * 1.08 && (!head || (y > 22 && r > SKIN[index]![0] * 0.76));
    if (!skinPixel && !head) continue; // Keep base underwear and ink.
    const source = skinPixel ? SKIN[index]! : HAIR[index]!;
    const target = skinPixel ? skin : hair;
    for (let channel = 0; channel < 3; channel++) {
      data[p + channel] = Math.min(255, Math.round(data[p + channel]! * target[channel]! / source[channel]!));
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.putImageData(pixels, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

function drawFace(ctx: CanvasRenderingContext2D, selection: AppearanceSelection, direction: WalkDirection): void {
  if (direction.startsWith("north")) return;
  const side = direction === "west" || direction === "east";
  const left = direction.endsWith("west") || direction === "west";
  ctx.save();
  // Keep expressions on the visible face: one eye in profile, none on the back.
  ctx.translate(side ? (left ? -9 : 9) : direction === "south" ? 0 : left ? -3 : 3, 0);
  if (side) {
    ctx.beginPath(); ctx.rect(left ? 14 : 32, 24, 18, 24); ctx.clip();
    ctx.translate(left ? 4 : -4, 0);
  }
  drawEyes(ctx, selection.eyes);
  if (selection.facialHair !== "facial-hair-none") {
    ctx.fillStyle = appearanceVisuals(selection).hairColor;
    ctx.fillRect(26, 42, 12, 2);
    if (selection.facialHair === "facial-hair-02") ctx.fillRect(27, 44, 10, 4);
  }
  ctx.fillStyle = selection.marking === "tattoo-01" ? "#38475c" : "#7d4438";
  if (selection.marking === "scar-01") ctx.fillRect(43, 34, 1, 8);
  if (selection.marking === "scar-02") ctx.fillRect(21, 39, 5, 1);
  if (selection.marking === "tattoo-01") ctx.fillRect(41, 39, 4, 3);
  ctx.restore();
}

/** Body and head remain independent of the starting outfit. */
export function drawWalkFrame(
  ctx: CanvasRenderingContext2D, images: readonly HTMLImageElement[], selection: AppearanceSelection,
  direction: WalkDirection, phase: number
): void {
  ctx.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  ctx.imageSmoothingEnabled = false;
  const head = spriteHeadIndex(selection.hair);
  const female = selection.bodyType === "body-02";
  const body = female ? (head >= 2 ? head : 2) : (head < 2 ? head : 0);
  const frameName = `${direction}-${phase}`;
  drawLayer(ctx, images, body, frameName, false, selection, false);
  ctx.save();
  ctx.translate(32, 0); ctx.scale(appearanceVisuals(selection).faceScaleX, 1); ctx.translate(-32, 0);
  // hair-05 is the mirrored chestnut cut; swap the source direction as well.
  const mirrored = selection.hair === "hair-05";
  const mirrorDirection = direction.replace(/east|west/g, side => side === "east" ? "west" : "east");
  drawLayer(ctx, images, head, `${mirrored ? mirrorDirection : direction}-${phase}`, true, selection, mirrored);
  drawFace(ctx, selection, direction);
  ctx.restore();
}

/** A transparent tunic layer, clipped to the moving torso and upper arms. */
export function drawWalkOutfit(
  ctx: CanvasRenderingContext2D, body: HTMLCanvasElement, selection: AppearanceSelection,
  direction: WalkDirection
): void {
  ctx.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  if (selection.startingOutfit === "outfit-base") return;
  const source = body.getContext("2d")!.getImageData(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  const pixels = ctx.createImageData(SPRITE_WIDTH, SPRITE_HEIGHT);
  const target = rgb(appearanceVisuals(selection).outfit);
  const side = direction === "west" || direction === "east";
  for (let y = 49; y < 78; y++) {
    const halfWidth = y < 62 ? 25 : side ? 9 : 13;
    for (let x = 32 - halfWidth; x < 32 + halfWidth; x++) {
      const p = (y * SPRITE_WIDTH + x) * 4;
      if (source.data[p + 3]! < 180) continue;
      const light = Math.max(source.data[p]!, source.data[p + 1]!, source.data[p + 2]!);
      const shade = light < 38 ? 0.35 : 0.7 + (light / 255) * 0.3;
      for (let k = 0; k < 3; k++) pixels.data[p + k] = Math.round(target[k]! * shade);
      pixels.data[p + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.save(); ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "#33271f"; ctx.fillRect(16, 72, 32, 3);
  if (!direction.startsWith("north")) {
    ctx.fillStyle = "#baa076"; ctx.fillRect(side ? direction === "east" ? 39 : 23 : 30, 72, 4, 3);
    if (!side) ctx.fillRect(28, 49, 8, 2);
  }
  ctx.restore();
}

export function drawWalkAtlas(
  bodyCtx: CanvasRenderingContext2D, outfitCtx: CanvasRenderingContext2D,
  images: readonly HTMLImageElement[], selection: AppearanceSelection
): void {
  const body = canvas(), outfit = canvas();
  WALK_DIRECTIONS.forEach((direction, row) => {
    for (let phase = 0; phase < 3; phase++) {
      drawWalkFrame(body.getContext("2d")!, images, selection, direction, phase);
      drawWalkOutfit(outfit.getContext("2d")!, body, selection, direction);
      bodyCtx.drawImage(body, phase * SPRITE_WIDTH, row * SPRITE_HEIGHT);
      outfitCtx.drawImage(outfit, phase * SPRITE_WIDTH, row * SPRITE_HEIGHT);
    }
  });
}
