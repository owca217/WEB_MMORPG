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
