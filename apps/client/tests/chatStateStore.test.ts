import { expect, it } from "vitest";
import { ChatStateStore } from "../src/state/ChatStateStore";
import type { ChatMessage } from "@web-mmorpg/shared";

const message = (id: string, channel: "nearby"|"global"="global"): ChatMessage => ({id,channel,senderId:"a",senderName:"A",text:id,sentAt:Number(id)||0});
it("deduplicates history and live events, bounds each channel and clears private transcript on reset", () => {
  const store=new ChatStateStore();
  let changes=0; const stop=store.subscribe(()=>changes++);
  store.add(message("1")); store.merge([message("1"),message("2")]);
  expect(store.get()).toHaveLength(2);
  store.merge(Array.from({length:120},(_,i)=>message(String(i+3))));
  store.add(message("near","nearby"));
  expect(store.get().filter(item=>item.channel==="global")).toHaveLength(100);
  const copy=store.get(); copy[0]!.text="mutated";
  expect(store.get()[0]!.text).not.toBe("mutated");
  store.reset(); expect(store.get()).toEqual([]); expect(changes).toBeGreaterThan(2); stop();
});
