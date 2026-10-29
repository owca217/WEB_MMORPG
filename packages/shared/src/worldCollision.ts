import { EASTERN_FOREST_LAYOUT, FOREST_SETTLEMENT_LAYOUT } from "./worldLayouts";

export interface WorldPoint { x:number; y:number }
export const WORLD_PLAYER_RADIUS=10;
export const WORLD_PLAYER_FOOT_OFFSET=20;
type Obstacle={kind:"circle";x:number;y:number;radius:number}|{kind:"rect";x:number;y:number;width:number;height:number};
const EPSILON=0.00001;
const settlement:Obstacle[]=[
  ...FOREST_SETTLEMENT_LAYOUT.trees.map(tree=>({kind:"circle" as const,x:tree.x,y:tree.y+6,radius:16})),
  ...FOREST_SETTLEMENT_LAYOUT.rocks.map(rock=>({kind:"rect" as const,x:rock.x-22,y:rock.y-35,width:44,height:30})),
  ...FOREST_SETTLEMENT_LAYOUT.buildings.map(building=>({kind:"rect" as const,x:building.x-building.width/2,y:building.y-building.height/2-WORLD_PLAYER_FOOT_OFFSET,width:building.width,height:building.height})),
  // The east fence is split around the rendered gate (visual y=385..555).
  {kind:"rect",x:106,y:146,width:808,height:8},
  {kind:"rect",x:106,y:696,width:808,height:8},
  {kind:"rect",x:106,y:150,width:8,height:550},
  {kind:"rect",x:906,y:150,width:8,height:215},
  {kind:"rect",x:906,y:535,width:8,height:165}
];
const forest:Obstacle[]=EASTERN_FOREST_LAYOUT.trees.map(tree=>({kind:"circle",x:tree.x,y:tree.y+4,radius:16}));
const obstacles=(locationId:string):readonly Obstacle[]=>locationId==="forest-settlement-01"?settlement:locationId==="eastern-forest-01"?forest:[];
export function getWorldBounds(locationId:string):{width:number;height:number}{return locationId==="eastern-forest-01"?{width:2000,height:1200}:{width:1600,height:900};}
const finite=(point:WorldPoint)=>Number.isFinite(point.x)&&Number.isFinite(point.y);
const clamp=(locationId:string,point:WorldPoint):WorldPoint=>{const bounds=getWorldBounds(locationId);return{x:Math.max(0,Math.min(bounds.width,point.x)),y:Math.max(0,Math.min(bounds.height,point.y))};};

export function isWorldPositionWalkable(locationId:string,point:WorldPoint):boolean {
  if(!finite(point))return false;
  const bounds=getWorldBounds(locationId);
  if(point.x<0||point.y<0||point.x>bounds.width||point.y>bounds.height)return false;
  return !obstacles(locationId).some(obstacle=>{
    if(obstacle.kind==="circle")return Math.hypot(point.x-obstacle.x,point.y-obstacle.y)<obstacle.radius+WORLD_PLAYER_RADIUS-EPSILON;
    return point.x>obstacle.x-WORLD_PLAYER_RADIUS+EPSILON&&point.x<obstacle.x+obstacle.width+WORLD_PLAYER_RADIUS-EPSILON
      &&point.y>obstacle.y-WORLD_PLAYER_RADIUS+EPSILON&&point.y<obstacle.y+obstacle.height+WORLD_PLAYER_RADIUS-EPSILON;
  });
}

interface Hit {t:number;normal:WorldPoint}
function firstHit(locationId:string,from:WorldPoint,to:WorldPoint):Hit|undefined {
  const dx=to.x-from.x,dy=to.y-from.y,lengthSquared=dx*dx+dy*dy;
  if(lengthSquared<EPSILON*EPSILON)return;
  let best:Hit|undefined;
  for(const obstacle of obstacles(locationId)) {
    let hit:Hit|undefined;
    if(obstacle.kind==="circle") {
      const x=from.x-obstacle.x,y=from.y-obstacle.y,radius=obstacle.radius+WORLD_PLAYER_RADIUS;
      const b=2*(x*dx+y*dy),c=x*x+y*y-radius*radius,discriminant=b*b-4*lengthSquared*c;
      if(discriminant<=EPSILON)continue;
      const t=(-b-Math.sqrt(discriminant))/(2*lengthSquared);
      if(t< -EPSILON||t>1)continue;
      const normal={x:(x+dx*Math.max(0,t))/radius,y:(y+dy*Math.max(0,t))/radius};
      if(dx*normal.x+dy*normal.y>=-EPSILON)continue;
      hit={t:Math.max(0,t),normal};
    }else {
      let enter=-Infinity,exit=Infinity,normal:WorldPoint={x:0,y:0},miss=false;
      for(const axis of ["x","y"] as const) {
        const delta=axis==="x"?dx:dy,start=from[axis];
        const min=obstacle[axis]-WORLD_PLAYER_RADIUS,max=min+(axis==="x"?obstacle.width:obstacle.height)+2*WORLD_PLAYER_RADIUS;
        // Traveling along a touching face is valid; only entering the inflated
        // rectangle's interior blocks a circular character.
        if(Math.abs(delta)<EPSILON){if(start<=min+EPSILON||start>=max-EPSILON)miss=true;continue;}
        const first=(min-start)/delta,last=(max-start)/delta,near=Math.min(first,last),far=Math.max(first,last);
        if(near>enter){enter=near;normal=axis==="x"?{x:delta>0?-1:1,y:0}:{x:0,y:delta>0?-1:1};}
        exit=Math.min(exit,far);
      }
      if(miss||enter>exit||exit<0||enter< -EPSILON||enter>1)continue;
      hit={t:Math.max(0,enter),normal};
    }
    if(hit&&(!best||hit.t<best.t))best=hit;
  }
  return best;
}

export function isWorldSegmentWalkable(locationId:string,from:WorldPoint,to:WorldPoint):boolean {
  if(!isWorldPositionWalkable(locationId,from)||!isWorldPositionWalkable(locationId,to))return false;
  const hit=firstHit(locationId,from,to);
  return !hit||hit.t>=1-EPSILON;
}

export function findNearestWalkablePosition(locationId:string,point:WorldPoint):WorldPoint {
  const origin=clamp(locationId,finite(point)?point:FOREST_SETTLEMENT_LAYOUT.spawn);
  if(isWorldPositionWalkable(locationId,origin))return origin;
  const bounds=getWorldBounds(locationId),limit=Math.hypot(bounds.width,bounds.height);
  for(let radius=2;radius<=limit;radius+=2) {
    for(let angle=0;angle<32;angle++) {
      const radians=angle*Math.PI/16,candidate=clamp(locationId,{x:origin.x+Math.cos(radians)*radius,y:origin.y+Math.sin(radians)*radius});
      if(isWorldPositionWalkable(locationId,candidate))return candidate;
    }
  }
  return locationId==="eastern-forest-01"?{...EASTERN_FOREST_LAYOUT.entry}:{...FOREST_SETTLEMENT_LAYOUT.spawn};
}

/** Sweeps every crossed obstacle, then spends only the remaining movement sliding along it. */
export function resolveWorldMovement(locationId:string,from:WorldPoint,to:WorldPoint):WorldPoint {
  let position=findNearestWalkablePosition(locationId,from);
  if(!finite(to))return position;
  const target=clamp(locationId,to);
  if(isWorldSegmentWalkable(locationId,position,target))return target;
  let remaining={x:target.x-position.x,y:target.y-position.y};
  for(let iteration=0;iteration<6;iteration++) {
    if(Math.hypot(remaining.x,remaining.y)<EPSILON)break;
    const end=clamp(locationId,{x:position.x+remaining.x,y:position.y+remaining.y});
    remaining={x:end.x-position.x,y:end.y-position.y};
    const hit=firstHit(locationId,position,end);
    if(!hit){if(isWorldPositionWalkable(locationId,end))position=end;break;}
    const travel=Math.max(0,hit.t-EPSILON);
    position={x:position.x+remaining.x*travel,y:position.y+remaining.y*travel};
    remaining={x:remaining.x*(1-hit.t),y:remaining.y*(1-hit.t)};
    const inward=remaining.x*hit.normal.x+remaining.y*hit.normal.y;
    if(inward<0)remaining={x:remaining.x-hit.normal.x*inward,y:remaining.y-hit.normal.y*inward};
  }
  return position;
}
