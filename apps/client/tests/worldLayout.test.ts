import { describe, expect, it } from "vitest";
import { calculateWorldLayout } from "../src/ui/worldLayout";

describe("world chrome viewport", () => {
  it("keeps desktop chrome outside the camera", () => {
    const layout=calculateWorldLayout(1280,720);
    expect(layout.compact).toBe(false);
    expect(layout.map).toEqual({x:0,y:40,width:1000,height:628});
    expect(layout.sidebar).toEqual({x:1000,y:40,width:280,height:628});
  });
  it.each([[844,390],[390,844],[1280,500]])("uses compact map width and safe areas at %s × %s", (width,height) => {
    const layout=calculateWorldLayout(width,height,{top:12,right:20,bottom:18,left:10});
    expect(layout.compact).toBe(true);expect(layout.map.x).toBe(10);expect(layout.map.y).toBe(68);
    expect(layout.map.width).toBe(width-30);expect(layout.map.y+layout.map.height).toBe(height-74);
  });
  it("keeps the camera positive during tiny resizes", () => {
    const {map}=calculateWorldLayout(1,1);expect(map.width).toBeGreaterThan(0);expect(map.height).toBeGreaterThan(0);
  });
});
