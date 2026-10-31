/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoldDisplay } from "../src/ui/GoldDisplay";

const displays: GoldDisplay[]=[];
function create(amount?: number): GoldDisplay {
  const display=new GoldDisplay();displays.push(display);document.body.append(display.element);display.update(amount);return display;
}
function button(display: GoldDisplay): HTMLButtonElement { return display.element.querySelector("button")!; }
function tooltip(display: GoldDisplay): HTMLElement { return display.element.querySelector('[role="tooltip"]')!; }
beforeEach(()=>document.body.replaceChildren());
afterEach(()=>{displays.splice(0).forEach(display=>display.destroy());vi.restoreAllMocks();});

it.each([
  [999,"999","999"], [1000,"1k","1 000"], [1999,"1k","1 999"],
  [999999,"999k","999 999"], [1000000,"1kk","1 000 000"], [50000000,"50kk","50 000 000"]
])("displays %s compactly without losing its exact integer",(amount,compact,exact)=>{
  const display=create(Number(amount));expect(display.element.querySelector("[data-gold]")?.textContent).toBe(compact);
  expect(display.element.textContent).toContain("Złoto");
  button(display).focus();expect(tooltip(display).hidden).toBe(false);
  expect(tooltip(display).textContent).toBe(`Dokładnie: ${exact} złota`);
  expect(button(display).getAttribute("aria-describedby")).toBe(tooltip(display).id);
  expect(button(display).getAttribute("aria-expanded")).toBe("true");
  expect(display.element.querySelector("input, textarea, .game-panel")).toBeNull();
});

it("opens on hover or focus and toggles with a click without creating an external panel",()=>{
  const display=create(1234),control=button(display),tip=tooltip(display);
  display.element.dispatchEvent(new MouseEvent("mouseenter"));expect(tip.hidden).toBe(false);
  control.click();expect(tip.hidden).toBe(false);
  control.click();expect(tip.hidden).toBe(true);
  control.click();expect(tip.hidden).toBe(false);
  display.element.dispatchEvent(new MouseEvent("mouseleave"));expect(tip.hidden).toBe(false);
  document.body.click();expect(tip.hidden).toBe(true);expect(control.getAttribute("aria-expanded")).toBe("false");
  control.focus();expect(tip.hidden).toBe(false);
  const escape=new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true});control.dispatchEvent(escape);
  expect(tip.hidden).toBe(true);expect(escape.defaultPrevented).toBe(true);
  expect(display.element.contains(tip)).toBe(true);
});

it("pins the first activation after compatibility hover and pointer focus then hides on the next activation",()=>{
  const display=create(50000),control=button(display);
  display.element.dispatchEvent(new MouseEvent("mouseenter"));
  control.dispatchEvent(new Event("pointerdown",{bubbles:true}));control.focus();control.click();
  expect(tooltip(display).hidden).toBe(false);
  control.dispatchEvent(new Event("pointerdown",{bubbles:true}));control.click();expect(tooltip(display).hidden).toBe(true);
});

it("refreshes an open tooltip and resets unavailable gold without inventing a balance",()=>{
  const display=create(),control=button(display),tip=tooltip(display);
  expect(display.element.querySelector("[data-gold]")?.textContent).toBe("—");expect(tip.hidden).toBe(true);
  display.update(1234);control.click();expect(tip.textContent).toBe("Dokładnie: 1 234 złota");
  display.update(50000000);expect(tip.hidden).toBe(false);expect(tip.textContent).toBe("Dokładnie: 50 000 000 złota");
  expect(display.element.querySelector("[data-gold]")?.textContent).toBe("50kk");
  display.update(undefined);expect(tip.hidden).toBe(true);expect(control.getAttribute("aria-expanded")).toBe("false");
  expect(tip.textContent).not.toContain("50 000 000");expect(display.element.querySelector("[data-gold]")?.textContent).toBe("—");
  control.click();expect(tip.hidden).toBe(true);
  display.update(1000);expect(tip.hidden).toBe(true);
});

it("removes the local tooltip and document listeners on destroy",()=>{
  const display=create(1000);button(display).click();expect(tooltip(display).hidden).toBe(false);
  const remove=vi.spyOn(document,"removeEventListener");display.destroy();
  expect(display.element.isConnected).toBe(false);
  expect(remove).toHaveBeenCalledWith("keydown",expect.any(Function),true);
  expect(remove).toHaveBeenCalledWith("pointerdown",expect.any(Function),true);
  expect(remove).toHaveBeenCalledWith("click",expect.any(Function),true);
  const escape=new KeyboardEvent("keydown",{key:"Escape",cancelable:true});document.dispatchEvent(escape);expect(escape.defaultPrevented).toBe(false);
  display.update(50000000);expect(display.element.querySelector("[data-gold]")?.textContent).toBe("1k");
});
