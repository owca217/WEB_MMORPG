import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

vi.mock("phaser",()=>({default:{Textures:{FilterMode:{NEAREST:0}}}}));
import { ForestSettlementRenderer } from "../src/world/ForestSettlementRenderer";
import { preloadEnvironmentAssets, registerEnvironmentFrames } from "../src/world/environmentAssets";

class ObjectView {
  depth=0; destroyed=0; mask:MaskView|undefined;
  constructor(public kind:string,public texture?:string){}
  setDepth(value:number){this.depth=value;return this;}
  setStrokeStyle(){return this;} setOrigin(){return this;} setDisplaySize(){return this;}
  setTileScale(){return this;} setTilePosition(){return this;} setTint(){return this;} setAlpha(){return this;}
  setMask(mask:MaskView){this.mask=mask;return this;} clearMask(){this.mask=undefined;return this;}
  lineStyle(){return this;} beginPath(){return this;} moveTo(){return this;} lineTo(){return this;}
  closePath(){return this;} fillPath(){return this;} strokePath(){return this;} strokeRect(){return this;} fillStyle(){return this;}
  fillRect(){return this;} fillPoints(){return this;}
  destroy(){this.destroyed+=1;}
}
class MaskView {destroyed=0;destroy(){this.destroyed+=1;}}
function createScene(loaded:boolean,webGL=false) {
  const objects:ObjectView[]=[],masks:MaskView[]=[];
  const frames=new Set<string>();
  const object=(kind:string,texture?:string)=>{
    const view=new ObjectView(kind,texture);
    Object.assign(view,{enableFilters:()=>view,filters:{external:{
      addMask:()=>{const mask=new MaskView();masks.push(mask);return mask;},
      remove:(mask:MaskView)=>mask.destroy()
    }}});
    if(webGL)view.setMask=()=>{throw new Error("GeometryMask is Canvas-only in Phaser4");};
    objects.push(view);return view;
  };
  const scene={
    renderer:{gl:webGL?{}:undefined},cameras:{main:{}},
    textures:{exists:()=>loaded,get:()=>({setFilter:vi.fn(),getSourceImage:()=>({width:1254}),has:(name:string)=>frames.has(name),add:(name:string)=>frames.add(name)})},
    load:{image:vi.fn()},
    add:{rectangle:()=>object("rectangle"),ellipse:()=>object("ellipse"),triangle:()=>object("triangle"),circle:()=>object("circle"),text:()=>object("text"),graphics:()=>object("graphics"),tileSprite:(_x:number,_y:number,_w:number,_h:number,texture:string)=>object("tileSprite",texture),image:(_x:number,_y:number,texture:string)=>object("image",texture)},
    make:{graphics:()=>{const graphic=object("maskGraphics");Object.assign(graphic,{createGeometryMask:()=>{const mask=new MaskView();masks.push(mask);return mask;}});return graphic;}}
  };
  return {scene:scene as unknown as Phaser.Scene,objects,masks};
}

describe("ForestSettlementRenderer environment assets",()=>{
  it("keeps the location visible when environment downloads fail",()=>{
    const {scene,objects}=createScene(false);
    expect(preloadEnvironmentAssets(scene)).toBeGreaterThan(0);
    registerEnvironmentFrames(scene);
    const renderer=new ForestSettlementRenderer(scene);renderer.render();
    expect(objects.some(object=>object.kind==="rectangle")).toBe(true);
    expect(objects.some(object=>object.kind==="text")).toBe(true);
    expect(objects.some(object=>object.kind==="tileSprite" || object.kind==="image")).toBe(false);
    renderer.destroy();expect(objects.every(object=>object.destroyed===1)).toBe(true);
  });
  it.each([false,true])("uses loaded graphics and releases masks on rerender/exit (WebGL=%s)",webGL=>{
    const {scene,objects,masks}=createScene(true,webGL);registerEnvironmentFrames(scene);
    const renderer=new ForestSettlementRenderer(scene);renderer.render();
    expect(preloadEnvironmentAssets(scene)).toBe(0);
    expect(objects.some(object=>object.kind==="tileSprite")).toBe(true);
    expect(objects.some(object=>object.kind==="image")).toBe(true);
    expect(objects.filter(object=>object.kind!=="maskGraphics").every(object=>object.depth<0)).toBe(true);
    const first=[...objects],firstMasks=[...masks];
    renderer.render();
    expect(first.every(object=>object.destroyed===1)).toBe(true);
    expect(firstMasks.every(mask=>mask.destroyed===1)).toBe(true);
    renderer.destroy();
    expect(objects.every(object=>object.destroyed===1)).toBe(true);
    expect(masks.every(mask=>mask.destroyed===1)).toBe(true);
  });
});
