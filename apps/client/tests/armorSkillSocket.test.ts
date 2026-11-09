import { afterEach, expect, it, vi } from 'vitest';
import { GameSocket } from '../src/net/GameSocket';
afterEach(()=>vi.restoreAllMocks());
it('forwards armor learn/reset acknowledgements and rejects responses from a replaced authentication',async()=>{
 const game=new GameSocket(),ack=vi.fn().mockResolvedValue({ok:true,character:{playerId:'hero'}}),socket={connected:true,timeout:vi.fn().mockReturnValue({emitWithAck:ack})};
 Object.assign(game,{socket,sessionToken:'session',socialCharacterId:'hero',authenticationVersion:1});vi.spyOn(game,'connect').mockReturnValue(socket as never);
 expect(await game.learnArmorSkill('cloth:power')).toMatchObject({ok:true});expect(ack).toHaveBeenLastCalledWith('learnArmorSkill',{skillId:'cloth:power'});
 expect(await game.resetArmorSkills('cloth')).toMatchObject({ok:true});expect(ack).toHaveBeenLastCalledWith('resetArmorSkills',{family:'cloth'});
 let resolve!:(value:unknown)=>void;ack.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=game.learnArmorSkill('plate:power');Object.assign(game,{authenticationVersion:2});resolve({ok:true,character:{playerId:'hero'}});
 expect(await pending).toMatchObject({ok:false,code:'SESSION_REPLACED'});
 Object.assign(game,{sessionToken:null});expect(await game.resetArmorSkills('leather')).toMatchObject({ok:false,code:'AUTHENTICATION_REQUIRED'});
});
