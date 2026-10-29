import type { HealingRequest, HealingResult, HealingTargetsResult } from "@web-mmorpg/shared";
import "./HealingPanel.css";

interface HealingPanelHandlers {
  requestTargets: () => Promise<HealingTargetsResult>;
  cast: (request: HealingRequest) => Promise<HealingResult>;
}

export class HealingPanel {
  private readonly root:HTMLDivElement;
  private readonly list:HTMLElement;
  private readonly feedback:HTMLElement;
  private version=0;
  private destroyed=false;
  private pending=false;
  private data:Extract<HealingTargetsResult,{ok:true}>|undefined;
  private cooldownUntil=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private readonly uncertain=new Map<string,HealingRequest>();
  private readonly onKey=(event:KeyboardEvent)=>{if(!this.root.hidden && event.key==="Escape"){event.stopPropagation();this.hide();}};

  constructor(private readonly handlers:HealingPanelHandlers) {
    this.root=document.createElement("div");this.root.className="game-panel healing-panel";this.root.dataset.healingPanel="";this.root.hidden=true;
    this.root.setAttribute("role","dialog");this.root.setAttribute("aria-label","Leczenie kosturem");
    this.root.innerHTML=`<div class="game-panel__header"><h2>Leczenie kosturem</h2><button type="button" data-close aria-label="Zamknij leczenie">×</button></div><p>Ulecz siebie lub pobliskiego członka drużyny. Zasięg: 160. Odnowienie: 10 sekund. Leczenie na mapie jest dostępne poza walką.</p><div data-healing-targets></div><p role="status" aria-live="polite" data-healing-feedback></p><button type="button" data-refresh-healing>Odśwież cele</button>`;
    this.list=this.root.querySelector("[data-healing-targets]")!;this.feedback=this.root.querySelector("[data-healing-feedback]")!;
    this.root.querySelector("[data-close]")!.addEventListener("click",()=>this.hide());
    this.root.querySelector("[data-refresh-healing]")!.addEventListener("click",()=>{void this.refresh();});
    for(const type of ["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend"])this.root.addEventListener(type,event=>event.stopPropagation());
    document.addEventListener("keydown",this.onKey,true);document.body.append(this.root);
  }

  async show():Promise<void> {if(this.destroyed)return;this.root.hidden=false;await this.refresh();}
  hide():void {this.root.hidden=true;this.version++;this.pending=false;if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
  destroy():void {this.hide();this.destroyed=true;document.removeEventListener("keydown",this.onKey,true);this.root.remove();}

  private async refresh():Promise<void> {
    if(this.destroyed || this.root.hidden || this.pending)return;
    const version=++this.version;this.pending=true;this.render();
    let result:HealingTargetsResult;
    try{result=await this.handlers.requestTargets();}catch{result={ok:false,code:"HEAL_TARGETS_FAILED",message:"Nie udało się pobrać celów leczenia."};}
    if(this.destroyed || this.root.hidden || version!==this.version)return;
    this.pending=false;
    if(result.ok){this.data=result;this.cooldownUntil=Date.now()+result.cooldownMs;}
    else{this.data=undefined;this.feedback.textContent=result.message;}
    this.render();
  }
  private render():void {
    this.root.setAttribute("aria-busy",String(this.pending));
    this.root.querySelector<HTMLButtonElement>("[data-refresh-healing]")!.disabled=this.pending;
    this.list.replaceChildren();
    if(!this.data){const label=document.createElement("p");label.textContent=this.pending?"Wczytywanie celów…":"Brak dostępnych celów.";this.list.append(label);return;}
    const cooldown=Math.max(0,this.cooldownUntil-Date.now());
    const summary=document.createElement("p");summary.textContent=`Moc leczenia: ${this.data.healingPower} HP${cooldown>0?` · Odnowienie: ${Math.ceil(cooldown/1000)} s`:""}`;this.list.append(summary);
    for(const target of this.data.targets){
      const button=document.createElement("button");button.type="button";button.dataset.healTarget=target.id;
      const retry=this.uncertain.has(target.id);
      button.textContent=`${retry?"Sprawdź wynik: ":"Lecz: "}${target.nickname} · ${target.hp}/${target.maxHp} HP${!target.available && !retry?` · ${target.reason??"Niedostępny"}`:""}`;
      button.disabled=this.pending || (!retry && (!target.available || cooldown>0));
      button.addEventListener("click",()=>{void this.heal(target.id);});this.list.append(button);
    }
    if(this.timer)clearTimeout(this.timer);
    if(cooldown>0 && !this.root.hidden)this.timer=setTimeout(()=>{this.timer=undefined;void this.refresh();},cooldown+50);
  }
  private async heal(targetId:string):Promise<void> {
    if(this.destroyed || this.root.hidden || this.pending)return;
    const target=this.data?.targets.find(item=>item.id===targetId),retry=this.uncertain.get(targetId);
    if(!target || (!retry && (!target.available || Date.now()<this.cooldownUntil)))return;
    const request=retry??{requestId:crypto.randomUUID(),targetId};
    const version=++this.version;this.pending=true;this.feedback.textContent="Leczenie…";this.render();
    let result:HealingResult;
    try{result=await this.handlers.cast(request);}catch{result={ok:false,code:"HEAL_REQUEST_UNCERTAIN",message:"Brak potwierdzenia. Sprawdź wynik tego samego leczenia."};}
    if(this.destroyed || this.root.hidden || version!==this.version)return;
    this.pending=false;
    if(result.ok){this.uncertain.delete(targetId);this.cooldownUntil=Date.now()+result.cooldownMs;this.feedback.textContent=`Przywrócono ${result.restoredHp} HP.`;}
    else{
      if(result.code==="HEAL_REQUEST_UNCERTAIN" || result.code==="HEAL_SAVE_UNCERTAIN")this.uncertain.set(targetId,request);
      else this.uncertain.delete(targetId);
      this.feedback.textContent=result.message;
    }
    this.render();
    if(result.ok || (result.code!=="HEAL_REQUEST_UNCERTAIN" && result.code!=="HEAL_SAVE_UNCERTAIN"))await this.refresh();
  }
}
