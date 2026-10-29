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
    { x: 72, y: 130 }, { x: 860, y: 125 }, { x: 935, y: 105 },
    { x: 90, y: 800 }, { x: 935, y: 785 }, { x: 780, y: 830 },
    { x: 1040, y: 120 }, { x: 1150, y: 100 }, { x: 1270, y: 145 }, { x: 1450, y: 110 },
    { x: 1080, y: 750 }, { x: 1190, y: 800 }, { x: 1390, y: 770 }, { x: 1520, y: 700 },
    { x: 1180, y: 270 }, { x: 1500, y: 310 }, { x: 1070, y: 610 }, { x: 1490, y: 590 }
  ],
  rocks: [
    { x: 1090, y: 360 }, { x: 1230, y: 690 }, { x: 1430, y: 390 }, { x: 1540, y: 500 }
  ],
  shrubs: [
    { x: 145, y: 380 }, { x: 145, y: 645 }, { x: 425, y: 665 }, { x: 820, y: 630 },
    { x: 820, y: 205 }, { x: 850, y: 585 }, { x: 815, y: 280 },
    { x: 995, y: 550 }, { x: 1140, y: 590 }, { x: 1280, y: 740 }, { x: 1470, y: 790 },
    { x: 1560, y: 340 }, { x: 1140, y: 190 }, { x: 1400, y: 275 }
  ],
  groundPlants: [
    { x: 180, y: 415 }, { x: 405, y: 375 }, { x: 530, y: 320 }, { x: 770, y: 390 },
    { x: 815, y: 535 }, { x: 350, y: 660 }, { x: 510, y: 730 }, { x: 745, y: 685 },
    { x: 230, y: 740 }, { x: 875, y: 340 }, { x: 935, y: 615 }, { x: 960, y: 300 },
    { x: 1030, y: 385 }, { x: 1150, y: 360 }, { x: 1240, y: 540 }, { x: 1390, y: 545 },
    { x: 1460, y: 435 }, { x: 1530, y: 575 }, { x: 1060, y: 830 }, { x: 1345, y: 235 }
  ]
} as const;

export interface ForestPoint {x:number;y:number}

const paths:readonly (readonly ForestPoint[])[]=[
  [{x:0,y:600},{x:330,y:600},{x:600,y:490},{x:1000,y:570},{x:1380,y:610},{x:1710,y:920},{x:2000,y:920}],
  [{x:330,y:600},{x:480,y:410},{x:760,y:260},{x:1110,y:280},{x:1450,y:330},{x:2000,y:330}],
  [{x:600,y:490},{x:650,y:820},{x:900,y:780},{x:1230,y:900},{x:1710,y:920}]
];
const clearings:readonly ForestPoint[]=[{x:150,y:600},{x:480,y:410},{x:900,y:780},{x:1450,y:330},{x:1680,y:900}];

function segmentDistance(point:ForestPoint,start:ForestPoint,end:ForestPoint):number {
  const dx=end.x-start.x,dy=end.y-start.y;
  const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(point.x-start.x-t*dx,point.y-start.y-t*dy);
}

export function isForestClearing(point:ForestPoint):boolean {
  return (point.x<230 && Math.abs(point.y-600)<150)
    || clearings.some(center=>Math.hypot(point.x-center.x,point.y-center.y)<100)
    || paths.some(path=>path.slice(1).some((end,index)=>segmentDistance(point,path[index]!,end)<58));
}

const trees:ForestPoint[]=[];
for(let row=0;row<11;row++)for(let column=0;column<19;column++) {
  const point={x:45+column*108+((row*31+column*17)%43)-21,y:66+row*109+((row*19+column*37)%39)-19};
  if(!isForestClearing(point))trees.push(point);
}

export const EASTERN_FOREST_LAYOUT={width:2000,height:1200,entry:{x:150,y:600},paths,clearings,trees} as const;
