import { findNearestWalkablePosition, getWorldBounds, isWorldPositionWalkable, isWorldSegmentWalkable, type WorldPoint } from "./worldCollision";

const GRID=24;
const distance=(a:WorldPoint,b:WorldPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
interface QueueItem {index:number;cost:number;score:number}
class MinQueue {
  private readonly values:QueueItem[]=[];
  push(item:QueueItem):void {let index=this.values.push(item)-1;while(index>0){const parent=(index-1)>>1;if(this.values[parent]!.score<=item.score)break;this.values[index]=this.values[parent]!;index=parent;}this.values[index]=item;}
  pop():QueueItem|undefined {const first=this.values[0],last=this.values.pop();if(!this.values.length||!last)return first;let index=0;while(true){let child=index*2+1;if(child>=this.values.length)break;if(child+1<this.values.length&&this.values[child+1]!.score<this.values[child]!.score)child++;if(this.values[child]!.score>=last.score)break;this.values[index]=this.values[child]!;index=child;}this.values[index]=last;return first;}
}

function goals(locationId:string,from:WorldPoint,target:WorldPoint,radius:number):WorldPoint[]{
  if(radius===0&&isWorldPositionWalkable(locationId,target))return[{...target}];
  const candidates:WorldPoint[]=[],start=Math.atan2(from.y-target.y,from.x-target.x);
  if(radius>0&&isWorldPositionWalkable(locationId,target))candidates.push({...target});
  if(radius>0) {
    for(let i=0;i<32;i++){const angle=start+i*Math.PI/16,candidate={x:target.x+Math.cos(angle)*radius,y:target.y+Math.sin(angle)*radius};if(isWorldPositionWalkable(locationId,candidate))candidates.push(candidate);}
    const nearest=findNearestWalkablePosition(locationId,target);if(distance(nearest,target)<=radius)candidates.push(nearest);
  }else {
    // A click on a trunk means walk to its perimeter, not into its solid center.
    for(let offset=2;offset<=96&&!candidates.length;offset+=2)for(let i=0;i<32;i++){
      const angle=start+i*Math.PI/16,candidate={x:target.x+Math.cos(angle)*offset,y:target.y+Math.sin(angle)*offset};if(isWorldPositionWalkable(locationId,candidate))candidates.push(candidate);
    }
  }
  return candidates.sort((a,b)=>distance(from,a)-distance(from,b));
}

export function findWorldPath(locationId:string,from:WorldPoint,target:WorldPoint,options:{arrivalRadius?:number}={}):WorldPoint[]|null {
  if(!Number.isFinite(from.x)||!Number.isFinite(from.y)||!Number.isFinite(target.x)||!Number.isFinite(target.y))return null;
  const start=findNearestWalkablePosition(locationId,from),bounds=getWorldBounds(locationId);
  const destination={x:Math.max(0,Math.min(bounds.width,target.x)),y:Math.max(0,Math.min(bounds.height,target.y))};
  const radius=Math.max(0,options.arrivalRadius??0);
  if(distance(start,destination)<=radius&&isWorldPositionWalkable(locationId,start))return[];
  const candidates=goals(locationId,start,destination,radius);
  if(!candidates.length)return null;
  for(const candidate of candidates)if(isWorldSegmentWalkable(locationId,start,candidate))return distance(start,candidate)<0.001?[]:[candidate];
  const columns=Math.ceil(bounds.width/GRID)+1,rows=Math.ceil(bounds.height/GRID)+1,count=columns*rows;
  const point=(index:number):WorldPoint=>({x:Math.min(bounds.width,(index%columns)*GRID),y:Math.min(bounds.height,Math.floor(index/columns)*GRID)});
  const free=new Int8Array(count),costs=new Float64Array(count).fill(Infinity),previous=new Int32Array(count).fill(-1),closed=new Uint8Array(count);
  const isFree=(index:number)=>{if(!free[index])free[index]=isWorldPositionWalkable(locationId,point(index))?1:-1;return free[index]===1;};
  const heuristic=(position:WorldPoint)=>Math.min(...candidates.map(candidate=>distance(position,candidate)));
  const queue=new MinQueue(),startColumn=Math.round(start.x/GRID),startRow=Math.round(start.y/GRID);
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const column=startColumn+dx,row=startRow+dy;if(column<0||row<0||column>=columns||row>=rows)continue;
    const index=row*columns+column,position=point(index);if(!isFree(index)||!isWorldSegmentWalkable(locationId,start,position))continue;
    const cost=distance(start,position);costs[index]=cost;queue.push({index,cost,score:cost+heuristic(position)});
  }
  let next:QueueItem|undefined;
  while((next=queue.pop())){
    if(closed[next.index]||next.cost!==costs[next.index])continue;closed[next.index]=1;
    const current=point(next.index),column=next.index%columns,row=Math.floor(next.index/columns);
    const goal=candidates.find(candidate=>distance(current,candidate)<=GRID*3&&isWorldSegmentWalkable(locationId,current,candidate));
    if(goal){
      const path:WorldPoint[]=[goal];for(let index=next.index;index!==-1;index=previous[index]!)path.push(point(index));path.reverse();
      const simplified:WorldPoint[]=[];let anchor=start;
      for(let index=0;index<path.length;){let farthest=index;for(let candidate=index+1;candidate<path.length;candidate++){if(!isWorldSegmentWalkable(locationId,anchor,path[candidate]!))break;farthest=candidate;}const endpoint=path[farthest]!;if(distance(anchor,endpoint)>0.001)simplified.push(endpoint);anchor=endpoint;index=farthest+1;}
      return simplified;
    }
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if((dx===0&&dy===0)||column+dx<0||column+dx>=columns||row+dy<0||row+dy>=rows)continue;
      const index=(row+dy)*columns+column+dx;if(closed[index]||!isFree(index))continue;
      if(dx&&dy&&(!isFree(row*columns+column+dx)||!isFree((row+dy)*columns+column)))continue;
      const position=point(index);if(!isWorldSegmentWalkable(locationId,current,position))continue;
      const cost=next.cost+distance(current,position);if(cost>=costs[index]!)continue;
      costs[index]=cost;previous[index]=next.index;queue.push({index,cost,score:cost+heuristic(position)});
    }
  }
  return null;
}
