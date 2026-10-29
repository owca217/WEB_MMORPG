import { expect,it } from "vitest";
import type { SocialSnapshot } from "@web-mmorpg/shared";
import { SocialStateStore } from "../src/state/SocialStateStore";
const initial:SocialSnapshot={revision:2,selfId:"a",onlinePlayers:[{id:"b",nickname:"B",online:true,inBattle:false}],friends:[],incomingFriendRequests:[],outgoingFriendRequests:[],party:null,partyInvites:[],trade:null};
it("keeps newer private snapshots, clones them and resets before another account",()=>{
  const store=new SocialStateStore();store.set(initial);store.set({...initial,revision:1,onlinePlayers:[]});
  expect(store.get()?.revision).toBe(2);expect(store.get()?.onlinePlayers).toHaveLength(1);
  store.get()!.onlinePlayers[0]!.nickname="mutated";expect(store.get()?.onlinePlayers[0]?.nickname).toBe("B");
  store.set({...initial,selfId:"other",revision:3});expect(store.get()?.selfId).toBe("a");
  store.reset();store.set({...initial,selfId:"other"});expect(store.get()?.selfId).toBe("other");
});
