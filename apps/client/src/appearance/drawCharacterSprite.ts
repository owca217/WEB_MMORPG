import type { AppearanceSelection } from "@web-mmorpg/shared";
import { appearanceVisuals } from "./appearanceVisuals";
import { SPRITE_HEIGHT, SPRITE_WIDTH, spriteHeadIndex } from "./characterSprites";

// Measured source rectangles share a neck line (y=48) and feet baseline (y=107).
const SOURCE_X = [137, 658, 1170, 1695];
const SOURCE_SKIN = [[255, 187, 144], [213, 150, 98], [255, 187, 144], [190, 131, 83]];
const SOURCE_HAIR = [[128, 79, 45], [48, 48, 52], [168, 66, 30], [179, 174, 180]];
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function drawLayer(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, index: number,
  fromY: number, height: number, skin: string, hair: string, mirror = false
): void {
  const layer = document.createElement("canvas");
  layer.width = SPRITE_WIDTH; layer.height = SPRITE_HEIGHT;
  const c = layer.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  if (mirror) { c.translate(SPRITE_WIDTH, 0); c.scale(-1, 1); }
  c.drawImage(atlas, SOURCE_X[index]!, 155 + fromY * 5, 320, height * 5, 0, fromY, 64, height);
  const pixels = c.getImageData(0, 0, 64, 108);
  const targetSkin = rgb(skin), targetHair = rgb(hair);
  const sourceSkin = SOURCE_SKIN[index]!, sourceHair = SOURCE_HAIR[index]!;
  for (let p = 0; p < pixels.data.length; p += 4) {
    const data = pixels.data, x = (p / 4) % 64, y = Math.floor(p / 256);
    if (data[p + 3]! < 160) { data[p + 3] = 0; continue; }
    data[p + 3] = 255;
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    // Preserve ink outlines, underwear, highlights and source shading.
    if (Math.max(r, g, b) < 38) continue;
    const warm = r > g * 1.12 && g > b * 1.12;
    const face = y >= 25 && y <= 45 && x >= 17 && x <= 48;
    const skinPixel = warm && (y >= 46 || (face && r > sourceSkin[0]! * 0.65));
    const hairPixel = y < 46 && !skinPixel && (y < 28 || x < 18 || x > 47);
    if (!skinPixel && !hairPixel) continue;
    const source = skinPixel ? sourceSkin : sourceHair;
    const target = skinPixel ? targetSkin : targetHair;
    for (let k = 0; k < 3; k++) data[p + k] = Math.min(255, data[p + k]! * target[k]! / source[k]!);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.putImageData(pixels, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

export function drawCharacterSprite(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, selection: AppearanceSelection,
  showOutfit = true
): void {
  const v = appearanceVisuals(selection);
  ctx.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  ctx.imageSmoothingEnabled = false;
  drawLayer(ctx, atlas, selection.bodyType === "body-02" ? 2 : 0, 48, 60, v.skin, v.hairColor);
  ctx.save();
  // Face width is independent of body and equipment.
  ctx.translate(32, 0); ctx.scale(v.faceScaleX, 1); ctx.translate(-32, 0);
  drawLayer(ctx, atlas, spriteHeadIndex(selection.hair), 0, 48, v.skin, v.hairColor, selection.hair === "hair-05");
  drawEyes(ctx, selection.eyes);
  if (selection.facialHair !== "facial-hair-none") {
    ctx.fillStyle = v.hairColor;
    ctx.fillRect(27, 42, 11, 2);
    if (selection.facialHair === "facial-hair-02") {
      ctx.fillRect(26, 44, 13, 3); ctx.fillRect(29, 47, 7, 2);
    }
  }
  ctx.fillStyle = selection.marking === "tattoo-01" ? "#38475c" : "#7d4438";
  if (selection.marking === "scar-01") { ctx.fillRect(44, 34, 1, 8); ctx.fillRect(43, 38, 3, 1); }
  if (selection.marking === "scar-02") { ctx.fillRect(21, 39, 5, 1); ctx.fillRect(23, 38, 1, 3); }
  if (selection.marking === "tattoo-01") { ctx.fillRect(41, 39, 4, 3); }
  ctx.restore();
  // Equipment is composited after the body; source art contains only base underwear.
  if (showOutfit && selection.startingOutfit !== "outfit-base") {
    ctx.fillStyle = "#20251f";
    ctx.fillRect(19, 49, 26, 31); ctx.fillRect(15, 51, 8, 12); ctx.fillRect(42, 51, 8, 12);
    ctx.fillStyle = v.outfit;
    ctx.fillRect(21, 50, 22, 28); ctx.fillRect(16, 52, 7, 9); ctx.fillRect(42, 52, 7, 9);
    ctx.fillStyle = "#b29b70"; ctx.fillRect(28, 50, 8, 2);
    ctx.fillStyle = "#3a2a20"; ctx.fillRect(21, 72, 22, 3);
    ctx.fillStyle = "#b29b70"; ctx.fillRect(30, 72, 4, 3);
  }
}

export function drawEyes(ctx: CanvasRenderingContext2D, style: string): void {
  const offset = style === "eyes-02" ? 1 : 0;
  for (const [x, side] of [[21 - offset, -1], [39 + offset, 1]]) {
    const left = x!, direction = side!;
    ctx.fillStyle = "#252128";
    if (style === "eyes-closed") {
      ctx.fillRect(left, 35, 6, 1); ctx.fillRect(left + 1, 36, 4, 1);
      continue;
    }
    const height = style === "eyes-03" ? 7 : 5;
    ctx.fillRect(left, 32, 6, height);
    ctx.fillStyle = "#fff0db"; ctx.fillRect(left, 32, 2, height - 1);
    ctx.fillStyle = "#17161b"; ctx.fillRect(left + 2, 32, 3, height);
    if (style === "eyes-sad" || style === "eyes-angry") {
      ctx.fillStyle = "#31252a";
      const slope = (style === "eyes-angry" ? 1 : -1) * direction;
      for (let step = 0; step < 3; step++) ctx.fillRect(left + step * 2, 28 + (slope > 0 ? 2 - step : step), 2, 2);
    }
  }
}
