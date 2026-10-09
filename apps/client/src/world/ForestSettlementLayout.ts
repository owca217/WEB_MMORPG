export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FOREST_SETTLEMENT_LAYOUT = {
  width: 1600,
  height: 900,
  spawn: { x: 360, y: 470 },
  settlement: { x: 100, y: 160, width: 820, height: 570 },
  gate: { x: 900, y: 385, width: 90, height: 170 },
  forest: { x: 980, y: 0, width: 620, height: 900 },
  wolfEncounter: { x: 1320, y: 455 },
  buildings: [
    { x: 245, y: 255, width: 250, height: 150, kind: "tavern" },
    { x: 625, y: 585, width: 225, height: 130, kind: "healer" }
  ],
  trees: [
    { x: 1040, y: 120 }, { x: 1150, y: 100 }, { x: 1270, y: 145 }, { x: 1450, y: 110 },
    { x: 1080, y: 750 }, { x: 1190, y: 800 }, { x: 1390, y: 770 }, { x: 1520, y: 700 },
    { x: 1180, y: 270 }, { x: 1500, y: 310 }, { x: 1070, y: 610 }, { x: 1490, y: 590 }
  ],
  rocks: [
    { x: 1090, y: 360 }, { x: 1230, y: 690 }, { x: 1430, y: 390 }, { x: 1540, y: 500 }
  ]
} as const;
