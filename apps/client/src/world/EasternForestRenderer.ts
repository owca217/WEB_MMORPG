import type Phaser from "phaser";
import { EASTERN_FOREST_LAYOUT, isForestClearing } from "./EasternForestLayout";
import { getEnvironmentTextureKey, VEGETATION_FRAMES, type VegetationTextureId } from "./environmentAssets";

/** A separate, deterministic woodland with open paths and encounter clearings. */
export class EasternForestRenderer {
  private readonly objects:Phaser.GameObjects.GameObject[]=[];
  constructor(private readonly scene:Phaser.Scene){}

  render():void {
    this.destroy();
    const layout=EASTERN_FOREST_LAYOUT;
    const floor=getEnvironmentTextureKey("forest-floor");
    if(this.scene.textures.exists(floor)) {
      const source=this.scene.textures.get(floor).getSourceImage();
      this.keep(this.scene.add.tileSprite(layout.width/2,layout.height/2,layout.width,layout.height,floor).setTileScale(256/source.width).setTint(0xb6c6a1).setDepth(-30));
    } else this.keep(this.scene.add.rectangle(layout.width/2,layout.height/2,layout.width,layout.height,0x28432c).setDepth(-30));

    const roads=this.keep(this.scene.add.graphics().setDepth(-26));
    for(const path of layout.paths) {
      roads.lineStyle(76,0x4a4a31,0.65).beginPath().moveTo(path[0]!.x,path[0]!.y);
      for(const point of path.slice(1))roads.lineTo(point.x,point.y);
      roads.strokePath();
      roads.lineStyle(48,0x746343,0.8).beginPath().moveTo(path[0]!.x,path[0]!.y);
      for(const point of path.slice(1))roads.lineTo(point.x,point.y);
      roads.strokePath();
    }
    for(const clearing of layout.clearings)this.keep(this.scene.add.ellipse(clearing.x,clearing.y,150,100,0x716745,0.26).setDepth(-25));
    for(const [index,tree] of layout.trees.entries()) {
      this.keep(this.scene.add.ellipse(tree.x+7,tree.y+10,75,30,0x0a180f,0.36).setDepth(-15));
      if(!this.plant(index%3===0 ? "oak" : "pine",tree.x,tree.y+24,146+index%5*10,-10)) {
        this.keep(this.scene.add.rectangle(tree.x,tree.y+10,14,44,0x483727).setDepth(-12));
        this.keep(this.scene.add.circle(tree.x,tree.y-15,39,0x21482c).setStrokeStyle(3,0x183620).setDepth(-10));
      }
      const shrub={x:tree.x+38,y:tree.y+35};
      if(index%2===0 && !isForestClearing(shrub))this.plant("shrubs",shrub.x,shrub.y,42+index%4*4,-9);
      if(index%3===0)this.plant("ground-plants",tree.x-31,tree.y+25,28,-14);
    }
    this.keep(this.scene.add.text(275,1065,"Gęsty Las",{fontFamily:"Georgia, serif",fontSize:"26px",color:"#e5dfb0",backgroundColor:"#14261bcc",padding:{x:12,y:7}}).setDepth(-5));
  }

  destroy():void {for(const object of this.objects.splice(0))object.destroy();}
  private keep<T extends Phaser.GameObjects.GameObject>(object:T):T {this.objects.push(object);return object;}
  private plant(id:VegetationTextureId,x:number,y:number,height:number,depth:number):boolean {
    const key=getEnvironmentTextureKey(id);
    if(!this.scene.textures.exists(key) || !this.scene.textures.get(key).has("plant"))return false;
    const frame=VEGETATION_FRAMES[id];
    this.keep(this.scene.add.image(x,y,key,"plant").setOrigin(0.5,1).setDisplaySize(height*frame.width/frame.height,height).setDepth(depth));
    return true;
  }
}
