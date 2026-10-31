/* @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest";
import {closeForegroundGamePanel,isForegroundGameWindow,isGameWindowOpen} from "../src/ui/gameWindows";

afterEach(()=>{document.body.replaceChildren();});

it("closes a floating social window without classifying its visible information as blocking movement",()=>{
  const panel=document.createElement("section");
  panel.dataset.floatingGameWindow="party";
  panel.style.cssText="position:fixed;z-index:1100";
  const close=document.createElement("button"),handler=vi.fn(()=>{panel.hidden=true;});
  close.dataset.close="";close.addEventListener("click",handler);panel.append(close);document.body.append(panel);
  expect(isGameWindowOpen()).toBe(false);
  expect(closeForegroundGamePanel()).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
  expect(closeForegroundGamePanel()).toBe(false);
});

it("prefers the open HUD Menu over floating information for foreground Back handling",()=>{
  const floating=document.createElement("section"),menu=document.createElement("section");
  floating.dataset.floatingGameWindow="party";floating.style.cssText="position:fixed;z-index:1117";
  menu.dataset.hudMenu="";menu.style.cssText="position:fixed;z-index:1130";
  document.body.append(floating,menu);
  expect(isForegroundGameWindow(floating)).toBe(false);expect(isForegroundGameWindow(menu)).toBe(true);
  menu.hidden=true;expect(isForegroundGameWindow(floating)).toBe(true);
});
