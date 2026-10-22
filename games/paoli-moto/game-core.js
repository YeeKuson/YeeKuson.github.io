/* Road Rash HTML prototype: deterministic world model, no DOM or renderer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RR = api;
})(globalThis, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const move = (v, target, step) => v < target ? Math.min(target, v + step) : Math.max(target, v - step);
  function contactFraction(before, after, half) {
    if (Math.min(before, after) > half || Math.max(before, after) < -half) return Infinity;
    if (before > half) return (before - half) / (before - after);
    if (before < -half) return (-half - before) / (after - before);
    return 0;
  }
  function random(seed) {
    let a = seed >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function terrainAt(track, distance) {
    const t=track.terrain;
    if(!t)return {elevation:0,grade:0};
    const s=Math.max(0,distance),cycle=Math.floor(s/t.span_m),f=s/t.span_m-cycle;
    const ys=t.profile,n=ys.length-1,u=f*n,i=Math.min(n-1,Math.floor(u)),v=u-i;
    const slope=k=>{
      const a=k===0?ys[n]-ys[n-1]:ys[k]-ys[k-1],b=k===n?ys[1]-ys[0]:ys[k+1]-ys[k];
      return a*b<=0?0:2*a*b/(a+b);
    };
    const a=ys[i],b=ys[i+1],ma=slope(i),mb=slope(i+1);
    const height=(2*v**3-3*v*v+1)*a+(v**3-2*v*v+v)*ma+(-2*v**3+3*v*v)*b+(v**3-v*v)*mb;
    const derivative=(6*v*v-6*v)*a+(3*v*v-4*v+1)*ma+(-6*v*v+6*v)*b+(3*v*v-2*v)*mb;
    return {elevation:(height-ys[0]+cycle*(ys[n]-ys[0]))*t.height_scale_m,grade:derivative*n/t.span_m*t.height_scale_m};
  }
  function roadAt(track, distance) {
    const s = Math.max(0, distance + (track.world_origin_m || 0));
    const sec = track.sections.find(q => s < q.to_m) || track.sections.at(-1);
    const local = s - sec.from_m, len = sec.to_m - sec.from_m;
    const taper = Math.min(1, Math.max(0, local / 100), Math.max(0, (len - local) / 100));
    const curveScale = {gentle: 0.0008, medium: 0.0017, tight: 0.0030}[sec.curve];
    const curve = Math.sin(local / (sec.curve_period_m || 130)) * curveScale * taper;
    const previous=track.sections[Math.max(0,track.sections.indexOf(sec)-1)];
    const mix=clamp(local/80,0,1),blend=mix*mix*(3-2*mix);
    const width=previous.road_width_m+(sec.road_width_m-previous.road_width_m)*blend;
    const lanes=(sec.lanes||2)>2&&width<18?2:sec.lanes||2;
    return roadFeatures(track,distance,{width,curve,...terrainAt(track,s),lanes,sidewalk:sec.sidewalk_m||0,theme:sec.theme,section:sec});
  }
  function crossingDistance(track,s){const points=track.crossings||[];let lo=0,hi=points.length-1;while(lo<=hi){const mid=(lo+hi)>>1;if(points[mid]<s)lo=mid+1;else hi=mid-1;}return Math.min(points[lo]===undefined?Infinity:Math.abs(points[lo]-s),points[lo-1]===undefined?Infinity:Math.abs(points[lo-1]-s));}
  function roadFeatures(track,s,r){
    const w=r.width/2;Object.assign(r,{count:1,left:-w,right:w,l1:-w,r1:w,l2:0,r2:0});r.junction=crossingDistance(track,s)<5;return r;
  }
  function surfaceAt(track,s,x,r=roadAt(track,s)){
    if(r.junction&&x>=r.left-22&&x<=r.right+22)return 'road';
    if(x>=r.l1&&x<=r.r1)return 'road';if(r.count===2&&x>=r.l2&&x<=r.r2)return 'road';return x>r.left&&x<r.right?'median':'shoulder';
  }
  function cameraAt(track,s,x,r=roadAt(track,s),lateralV=0,speed=0){
    return {x:x-clamp(x*.28,-2.5,2.5),yaw:0};
  }
  function steering(bike,v,curve){const authority=bike.lateral_speed_m_per_s*(.65+.35*clamp(v/bike.max_speed_kmh,0,1))*clamp(v/12,0,1);return {authority,drift:clamp(curve*(v/3.6)**2*.65,-authority*.28,authority*.28)};}
  function sweptContact(s0,x0,s1,x1,hs,hx){
    let enter=0,leave=1;for(const [p,d,h]of [[s0,s1-s0,hs],[x0,x1-x0,hx]]){if(d===0){if(Math.abs(p)>h)return Infinity;}else{let a=(-h-p)/d,b=(h-p)/d;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);leave=Math.min(leave,b);}}return enter<=leave?enter:Infinity;
  }
  function recoveryPose(r) {
    const anchor=(r.launchS??r.bikeS)-r.bikeS,x=r.personX??r.launchX??r.bikeX+r.side*.6;
    if(r.personS!==undefined){
      const u=r.mountAge===undefined?0:clamp(r.mountAge/(r.mountDuration||.85),0,1),blend=u*u*(3-2*u);
      return {phase:r.mountAge===undefined?'run':'mount',offset:(r.personS-r.bikeS)*(1-blend),x:x+(r.bikeX-x)*blend,height:0,rotation:0,mountProgress:u,walking:r.walking!==false};
    }
    const t=r.age, flight=r.flight||.8, slide=.55, stand=.45, runStart=flight+slide+stand;
    if(t<flight){const u=t/flight;return {phase:'air',offset:anchor+r.distance*.75*u,x,height:Math.sin(u*Math.PI)*(r.height||2),rotation:u*Math.PI*1.6};}
    if(t<flight+slide){const u=(t-flight)/slide;return {phase:'slide',offset:anchor+r.distance*(.75+.25*u),x,height:Math.sin(u*Math.PI)*.12,rotation:Math.PI*1.6+u*.5};}
    if(t<runStart){const u=(t-flight-slide)/stand,start=Math.PI*1.6+.5;return {phase:'stand',offset:anchor+r.distance,x,height:0,rotation:start+(Math.PI*2-start)*u};}
    const offset=Math.max(0,r.distance-(t-runStart)*5);
    return {phase:offset>0?'run':'mount',offset:anchor+offset,x,height:0,rotation:0,mountProgress:0};
  }
  class Game {
    constructor(config, seed = 19960823) {
      this.config = config; this.serial = 0; this.events = []; this.selectedTrack = config.tracks[0].id;
      this.selectedBike = config.bikes[0].id; this.selectedWeapon='none'; this.completionEligible=false;this.seed = seed; this.toTitle();
    }
    emit(type, detail = {}) { this.events.push({type, ...detail, time: this.time}); if (this.events.length > 1000) this.events.shift(); }
    get track() { return this.raceTrack || this.config.tracks.find(t => t.id === this.selectedTrack); }
    get bike() { return this.raceBike || this.config.bikes.find(b => b.id === this.selectedBike); }
    get road() { return roadAt(this.track, this.player.s); }
    clearInput() { this.input = {left: false, right: false, forward:false, backward:false, brake: false, hand:false, foot:false}; }
    beginTour(seed=this.seed+this.serial+1){
      if(!['title','result'].includes(this.state))return false;
      const base=this.bike.family,rng=random(seed),tracks=['short','medium','long'].map(tier=>{const pool=this.config.tracks.filter(t=>t.tier===tier);return pool[Math.floor(rng()*pool.length)].id;});
      this.selectedBike=base;this.selectedTrack=tracks[0];this.toTitle();
      const scores={player:0},best={player:16};for(let i=1;i<=14;i++){const id='rider_'+String(i).padStart(2,'0');scores[id]=0;best[id]=16;}
      this.tour={round:1,tracks,wallet:0,scores,best,results:[],upgrades:{},weapon:null,bought:false,completed:false,seed};return this.start(seed);
    }
    buyTour(id){
      const t=this.tour,c=this.config.championship;if(this.state!=='result'||!t||t.completed||!Object.hasOwn(c.prices,id)||t.wallet<c.prices[id])return false;
      if(id==='handling'||id==='power'){if(t.upgrades[id])return false;t.upgrades[id]=true;}
      else if(id==='upgrade'){if(this.bike.tier!==1||t.upgrades.upgrade)return false;const next=this.config.bikes.find(b=>b.family===this.bike.family&&b.tier===2);if(!next)return false;this.selectedBike=next.id;t.upgrades.upgrade=true;}
      else if(Object.hasOwn(this.config.weapons,id)){if(t.weapon===id)return false;t.weapon=id;}else return false;
      t.wallet-=c.prices[id];t.bought=true;this.emit('tour_purchase',{item:id});return true;
    }
    nextTourStage(){const t=this.tour;if(this.state!=='result'||!t||t.completed)return false;t.round++;t.bought=false;this.selectedTrack=t.tracks[t.round-1];return this.start(t.seed+t.round*997);}
    settleTour(){
      const t=this.tour,c=this.config.championship;if(!t||t.results[t.round-1])return;
      const r=this.result,place=r.reason==='finish'?r.rank:15,bonus=place===1?100:place===2?80:place===3?60:place<=6?40:place<=10?20:0,reward=r.reason==='finish'?c.finish_reward+bonus:c.arrest_reward;
      t.wallet+=reward;t.weapon=this.player.weapon;t.bought=false;
      const finish=new Map(this.finished.map((id,i)=>[id,i+1])),order=this.ai.slice().sort((a,b)=>(finish.get(a.id)||99)-(finish.get(b.id)||99)||b.s-a.s||a.id.localeCompare(b.id)).map(a=>a.id);order.splice(place-1,0,'player');
      for(const [i,id]of order.entries()){t.scores[id]+=id==='player'&&r.reason!=='finish'?0:c.points[i];t.best[id]=Math.min(t.best[id],id==='player'&&r.reason!=='finish'?16:i+1);}
      t.results.push({rank:place,reason:r.reason,reward,time:r.time,track:r.track});t.completed=t.round===3;r.tour_round=t.round;r.reward=reward;r.tour_final=t.completed;
    }
    getTourStandings(){return this.tour?Object.entries(this.tour.scores).map(([id,points])=>({id,points,best:this.tour.best[id]})).sort((a,b)=>b.points-a.points||a.best-b.best||a.id.localeCompare(b.id)):[];}
    reset(seed) {
      const base=this.config.bikes.find(b=>b.id===this.selectedBike),t=this.tour,c=this.config.championship;
      this.raceBike=t?{...base}:base;
      if(t?.upgrades.handling){this.raceBike.lateral_speed_m_per_s*=c.handling_ratio;this.raceBike.braking_kmh_per_s*=c.braking_ratio;}
      if(t?.upgrades.power)this.raceBike.acceleration_kmh_per_s*=c.power_ratio;
      this.aiBike=t?{max_speed_kmh:c.ai_speed_kmh[t.round-1],acceleration_kmh_per_s:c.ai_acceleration_kmh_per_s,braking_kmh_per_s:c.ai_braking_kmh_per_s,offroad_speed_kmh:70}:this.raceBike;
      this.rng = random(seed); this.time = 0; this.phaseTime = 0; this.accumulator = 0;
      this.player = {id: 'player', kind: 'player', weapon:t?t.weapon:this.selectedWeapon==='none'?null:this.selectedWeapon, s: 0, x: 0, v: 0, lateralV:0, lean: 0, grace: 0, hitGrace: 0, stagger:0, crashCount: 0, action: null, push: 0};
      this.crossingUsed=new Set();this.crossingDecision=0;this.racePaceV=null;this.aiDecision=0;this.duelBuddy=null;this.duelUntil=0;this.ai = []; this.traffic = []; this.police = null; this.result = null; this.recovery = null;
      this.capture = 0; this.lastCaptureMode = ''; this.patrolUsed = new Set(); this.patrolDispatches=new Map();this.lastPatrolTime=-Infinity;this.nextTraffic = this.config.traffic.opening_wave_s;this.openingTrafficIssued=false;
      this.raceTrack=null; this.clearInput(); this.finished = [];
      this.viewS = 0; this.screenFlash = 0; this.impact = null;this.cameraImpulse=null; this.crashEffects=[]; this.events = [];
      this.allowRandomTraffic = true; this.allowPatrols = true;
    }
    toTitle() {
      this.tour=null;this.reset(this.seed); this.state = 'title'; this.demoS = 0;
      this.traffic = Array.from({length: 9}, (_, i) => this.makeTraffic(40 + i * 58, i));
      this.player.stamina=this.config.stamina.capacity;this.emit('title');
    }
    selectTrack(id) { if (this.state !== 'title' || !this.config.tracks.some(t => t.id === id)) return false; this.selectedTrack = id; this.toTitle(); this.emit('track_selected', {id}); return true; }
    selectBike(id) { if (this.state !== 'title' || !this.config.bikes.some(b => b.id === id)) return false; this.selectedBike = id; this.raceBike=null;this.emit('bike_selected', {id}); return true; }
    selectWeapon(id) {if(this.state!=='title'||typeof id!=='string'||id!=='none'&&!Object.hasOwn(this.config.weapons,id))return false;this.selectedWeapon=id;this.player.weapon=id==='none'?null:id;this.emit('weapon_selected',{id});return true;}
    start(seed = this.seed + ++this.serial) {
      if (!['title', 'result'].includes(this.state)) return false;
      const demoS=this.state==='title'?this.demoS:0,traffic=this.state==='title'?this.traffic:[];
      this.reset(seed); this.state = 'approach';
      this.approachDistance=this.config.race.approach_s*24/2;
      this.raceTrack={...this.track,world_origin_m:demoS+this.approachDistance};
      this.viewS = -this.approachDistance;
      this.traffic=traffic.map(c=>({...c,s:c.s-this.raceTrack.world_origin_m}));
      const colors = ['#db5945', '#6cc6bc', '#cbcccf', '#ab85cb', '#e3aa49', '#628dbb', '#9db965'];
      const ratios=this.config.ai.cruise_speed_ratio,palettes=this.config.appearance.ai_palettes;
      this.ai = Array.from({length: 14}, (_, i) => ({id: `rider_${String(i + 1).padStart(2, '0')}`, kind: 'rider', s: this.config.race.grid_first_row_m + Math.floor(i / 2) * this.config.race.grid_row_spacing_m, x: i % 2 ? 1.9 : -1.9, v: 0, lateralV:0, preferredLane:[-1.9,-.3,1.6][i%3], baseSpeed: this.aiBike.max_speed_kmh*(ratios[0]+this.rng()*(ratios[1]-ratios[0])), pacePhase:i*1.7, decisionIn:0, color: colors[i % colors.length],skin:{...palettes[i%palettes.length],pattern:Math.floor(i/palettes.length),helmet:i<7?palettes[i%7].helmet:palettes[(i+3)%7].helmet}, state: 'riding', recoveryLeft: 0, grace: 0, hitGrace: 0, attackGrace:0, stagger:0, arrestImmune:0, attackTimer: 3 + this.rng() * 4, action: null, push: 0, finished: false}));
      for(const a of this.ai){
        a.pacePhase=this.rng()*Math.PI*2;a.pacePeriod=14+this.rng()*18;
        a.aggression=.25+this.rng()*.65;a.passSide=this.rng()<.5?-1:1;
        a.preferredLane=(this.rng()-.5)*4.5;a.reactUntil=0;a.rivalId=null;
        a.launchDelay=this.rng()*1.1;a.acceleration=18+this.rng()*11;
        a.simMode='full';a.historyTime=6;a.historyDistance=a.baseSpeed/3.6*6;
      }
      this.player.stamina=this.config.stamina.capacity;this.ai.forEach((a,i)=>{a.stamina=this.config.stamina.capacity;a.gridIndex=i+1;a.cohort=i<3?1:i<7?2:i<11?3:4;a.branch=(i+1)%2+1;a.launchDelay=(4-a.cohort)*this.config.ai.cohort_launch_delay_step_s+(a.gridIndex%2)*.025;a.weapon=({3:'bat',7:'chain',11:'bat'})[i+1]||null;a.acceleration=this.aiBike.acceleration_kmh_per_s*(this.config.ai.cohort_acceleration_base_ratio+a.cohort*this.config.ai.cohort_acceleration_step_ratio);});this.emit('approach'); return true;
    }
    pause() { if (['racing', 'recovering', 'approach', 'countdown'].includes(this.state)) { this.savedState = this.state; this.state = 'paused'; this.clearInput(); this.emit('paused'); return true; } return false; }
    resume() { if (this.state !== 'paused') return false; this.state = this.savedState; this.clearInput(); this.emit('resumed'); return true; }
    abandon() { if (this.state === 'paused') { this.toTitle(); this.emit('aborted'); return true; } return false; }
    withdrawTour(){if(!this.tour||!['result','paused'].includes(this.state))return false;const stages=this.tour.results.length;this.toTitle();this.emit('tour_withdrawn',{stages,eligible:this.completionEligible});return true;}
    interact(kind) {
      const replaceHand=kind==='foot'&&this.player.action?.kind==='hand'&&this.player.action.age===0;
      if (this.state !== 'racing' || this.player.stagger>0 || !['hand', 'foot'].includes(kind) || this.player.action&&!replaceHand) return false;
      const weapon=kind==='hand'?this.player.weapon:null;if(weapon)kind=weapon;const range=this.attackRange(kind,weapon);
      const targets = [...this.ai, ...(this.police ? [this.police] : [])].filter(v => !v.finished && v.state === 'riding' && v.grace<=0 && !(v.attackGrace>0) && Math.abs(v.s - this.player.s) <= range.s && Math.abs(v.x - this.player.x) <= range.x);
      targets.sort((a,b) => Math.hypot(a.s-this.player.s,a.x-this.player.x)-Math.hypot(b.s-this.player.s,b.x-this.player.x) || a.id.localeCompare(b.id));
      const target = targets[0];
      this.player.action = {kind, weapon, age: 0, hit: false, targetId: target?.id, side: target ? Math.sign(target.x - this.player.x) || 1 : 1, windup:kind==='foot'?this.config.interaction.foot_windup_s:this.config.interaction.windup_s};
      this.emit('action', {kind}); return true;
    }
    attackRange(kind,weapon){const c=this.config.interaction,w=weapon&&this.config.weapons[weapon];return {s:w?w.longitudinal_range_m:kind==='foot'?c.foot_longitudinal_range_m:c.longitudinal_range_m,x:w?w.lateral_range_m:kind==='foot'?c.foot_lateral_range_m:c.lateral_range_m};}
    rank() { return 1 + this.ai.filter(a => a.finished || a.s > this.player.s).length; }
    end(reason) {
      if (!['finish','arrest'].includes(reason)||!['racing', 'recovering'].includes(this.state) || this.result) return false;
      const arrivalMode=this.state==='recovering'?'foot':'bike';
      this.result = {reason, completed: true, track: this.selectedTrack, bike: this.selectedBike, rank: this.rank(), time: this.time, distance: clamp(this.player.s, 0, this.track.length_m), crashes: this.player.crashCount,arrivalMode};this.settleTour();this.completionEligible=true;Object.freeze(this.result);
      this.state = reason === 'arrest' ? 'arresting' : 'finishing'; this.phaseTime = 0; this.clearInput();this.player.action=null;
      this.emit('ended', {reason}); return true;
    }
    staminaCapacity(a){return a.kind==='police'?this.config.stamina.police_capacity:this.config.stamina.capacity;}
    damage(a,amount,cause){
      if((a===this.player?this.state!=='racing':a.state!=='riding'||a.finished)||a.grace>0||amount<=0)return false;
      a.stamina=Math.max(0,(a.stamina??this.staminaCapacity(a))-amount);if(a.stamina===0)this.crashRider(a,cause);return true;
    }
    crash(cause = 'collision') {
      if (this.state !== 'racing' || this.player.grace > 0) return false;
      const p = this.player;this.recovery=this.makeRecovery(p);
      this.state = 'recovering'; p.stamina=0;p.crashCount++; p.v = 0; p.lateralV=0; p.action = null; this.capture = 0; this.clearInput(); this.screenFlash = .6;
      this.setImpact({age:0,kind:'crash',side:this.recovery.side,s:p.s,x:p.x,strength:1},true);this.emit('crash', {cause}); return true;
    }
    setImpact(impact,playerInvolved=false){
      this.impact=impact;if(!playerInvolved)return;
      const c=this.config.feedback,strong=['crash','collision','bat'].includes(impact.kind),amplitude=strong?c.crash_camera_px:impact.kind==='foot'?c.foot_camera_px:c.hand_camera_px;
      if(this.cameraImpulse&&this.cameraImpulse.age<this.cameraImpulse.duration&&this.cameraImpulse.amplitude>=amplitude)return;
      this.cameraImpulse={age:0,amplitude,duration:strong?c.crash_shake_s:c.hit_shake_s};
    }
    cameraOffset(){
      const r=this.cameraImpulse;if(!r)return {x:0,y:0};const amplitude=Math.max(0,1-r.age/r.duration)*r.amplitude;
      return {x:Math.sin(r.age*100)*amplitude,y:Math.cos(r.age*83)*amplitude*.25};
    }
    makeRecovery(rider){
      const speed=rider.v,distance=6+clamp(speed/160,0,1)*8,flight=.6+clamp(speed/400,0,.4),road=roadAt(this.track,rider.s);
      return {age:0,distance,flight,height:1.4+speed/80,duration:flight+1.6+distance/5,bikeS:Math.min(this.track.length_m-3,Math.max(0,rider.s)),bikeX:clamp(rider.x,road.left+.7,road.right-.7),side:Math.sign(rider.push)||Math.sign(rider.x)||1,originalX:rider.x,speed};
    }
    crashRider(rider,cause){
      if(rider===this.player)return this.crash(cause);
      if(rider.state!=='riding'||rider.grace>0)return false;
      rider.recovery=this.makeRecovery(rider);
      // NPCs carry momentum into the visible road, independently of the player's recovery camera.
      const r=rider.recovery;r.carrySpeed=r.speed/3.6*.9;
      r.distance+=r.speed/3.6*.3;r.flight+=.2;r.height+=.5;r.duration=r.flight+1.6+r.distance/5;
      this.crashEffects.push({age:0,s:rider.s,x:rider.x,side:r.side,speed:r.speed,id:rider.id});
      if(Math.abs(rider.s-this.player.s)<18)this.impact={age:0,kind:'collision',side:r.side,s:rider.s,x:rider.x,strength:.7};
      rider.state='recovering';rider.stamina=0;rider.recoveryLeft=r.duration;rider.v=0;rider.lateralV=0;rider.action=null;
      this.emit(rider.kind==='police'?'pursuer_crash':'rider_crash',{id:rider.id,cause,s:rider.s,x:rider.x});return true;
    }
    updateRecovery(rider,dt){
      if(!['recovering','detained'].includes(rider.state))return false;
      rider.recoveryLeft-=dt;
      const complete=rider.recovery?this.advanceRecovery(rider,dt):rider.recoveryLeft<=0;
      if(complete){rider.state='riding';rider.stamina=this.staminaCapacity(rider);rider.grace=2;rider.v=0;rider.push=0;if(rider.recovery){rider.s=rider.recovery.bikeS;rider.x=rider.recovery.bikeX;}rider.recovery=null;}
      return true;
    }
    advanceRecovery(rider,dt,input=null){
      const r=rider===this.player?this.recovery:rider.recovery;if(!r)return false;
      r.age+=dt;r.bodyGrace=Math.max(0,(r.bodyGrace||0)-dt);
      const travel=Math.max(0,r.carrySpeed||0)*dt;r.bikeS=Math.min(this.track.length_m-3,r.bikeS+travel);r.carrySpeed=move(r.carrySpeed||0,0,24*dt);
      if(rider!==this.player)rider.s=r.bikeS;
      if(r.age<r.flight+1)return false;
      if(r.personS===undefined){r.personS=(r.launchS??r.bikeS)+r.distance;r.personX=r.launchX??r.bikeX+r.side*.6;}
      if(r.mountAge!==undefined){r.mountAge+=dt;return r.mountAge>=(r.mountDuration||.85);}
      let dx=input?Number(input.right)-Number(input.left):0,ds=input?Number(input.forward)-Number(input.backward):0;
      const manual=dx!==0||ds!==0;
      if(!manual){dx=r.bikeX-r.personX;ds=r.bikeS-r.personS;}
      const length=Math.hypot(dx,ds),speed=this.config.contact.return_run_speed_m_per_s;
      r.walking=length>.02;
      if(!manual&&length<=.65){r.mountAge=0;r.mountDuration=this.config.contact.remount_s;this.emit('mounting',{id:rider.id});return false;}
      const travelOnFoot=Math.min(speed*dt,manual?Infinity:length);
      if(length>0){r.personS=Math.max(0,r.personS+ds/length*travelOnFoot);const road=roadAt(this.track,r.personS);r.personX=clamp(r.personX+dx/length*travelOnFoot,road.left-3,road.right+3);}
      if(rider!==this.player)rider.s=r.bikeS;
      return false;
    }
    hitOnFoot(rider,source,cause){
      const r=rider===this.player?this.recovery:rider.recovery;
      if(!r||r.bodyGrace>0||recoveryPose(r).phase==='air'||recoveryPose(r).height>.4)return false;
      const pos=this.personPosition(rider),speed=Math.max(45,Math.abs(source.v||0));
      r.launchS=pos.s;r.launchX=pos.x;r.personS=undefined;r.personX=undefined;r.mountAge=undefined;
      r.age=0;r.flight=.55+Math.min(.35,speed/500);r.height=1+speed/100;r.distance=3+Math.min(12,speed/12);r.side=Math.sign(pos.x-source.x)||r.side;r.bodyGrace=.85;r.carrySpeed=0;
      r.duration=r.flight+1.6+Math.abs(pos.s-r.bikeS)/5+r.distance/5;rider.recoveryLeft=r.duration;
      if(rider===this.player){rider.crashCount++;this.capture=0;this.screenFlash=.4;}
      this.crashEffects.push({age:0,s:pos.s,x:pos.x,side:r.side,speed,id:rider.id});this.setImpact({age:0,kind:'collision',s:pos.s,x:pos.x,side:r.side,strength:.8},rider===this.player);
      this.emit('onfoot_hit',{id:rider.id,source:source.id,cause,s:pos.s,x:pos.x});return true;
    }
    parkRider(rider){
      rider.finished=true;rider.state='finished';rider.action=null;this.finished.push(rider.id);
      const slot=this.finished.length-1;rider.parking={age:0,s:rider.s,x:rider.x,v:rider.v,targetS:this.track.length_m+10+Math.floor(slot/2)*5,targetX:(slot%2?1:-1)*2.8};
      this.emit('rider_finished',{id:rider.id,place:this.finished.length});
    }
    updateParked(dt){
      for(const a of this.ai)if(a.parking){const r=a.parking;r.age+=dt;const t=clamp(r.age/1.1,0,1),u=1-(1-t)**3;a.s=r.s+(r.targetS-r.s)*u;a.x=r.x+(r.targetX-r.x)*u;a.v=r.v*(1-t)**2;if(t===1){a.v=0;a.parking=null;}}
    }
    makeTraffic(s, index = 0) {
      const oncoming = this.rng() < .42;
      const direction=oncoming?-1:1,laneIndex=Math.floor(this.rng()*(roadAt(this.track,s).lanes/2));
      return {id: `traffic_${index}_${Math.floor(this.rng()*1e8)}`, kind: this.rng() < .2 ? 'truck' : 'car', branch:direction<0?1:2,s, x:this.trafficLane(s,direction,laneIndex),laneIndex,direction, v:direction*(45+this.rng()*35), color: ['#c8d5cf','#d49e5a','#687b8d','#d1b9a1','#796d80'][Math.floor(this.rng()*5)]};
    }
    trafficLane(s,direction,laneIndex=0){
      const road=roadAt(this.track,s);if(road.count===2)return direction<0?(road.l1+road.r1)/2:(road.l2+road.r2)/2;const lanes=road.lanes/2,index=Math.min(lanes-1,laneIndex);
      return direction*(index+.5)*road.width/road.lanes;
    }
    moveTrafficLane(car,dt){
      if(car.crossing||!car.direction)return;
      const road=roadAt(this.track,car.s),nextS=car.s+car.direction*Math.max(30,Math.abs(car.v)/3.6*3);
      const lane=Math.min(Math.abs(this.trafficLane(car.s,car.direction,car.laneIndex)),Math.abs(this.trafficLane(nextS,car.direction,car.laneIndex)));
      if(road.count===2){car.x=move(car.x,this.trafficLane(car.s,car.direction,car.laneIndex),3.2*dt);return;}const half=car.kind==='truck'?1.15:.9;
      car.x=car.direction*clamp(move(Math.abs(car.x),lane,2.6*dt),half+.2,road.width/2-half-.2);
    }
    spawnPolice(s) {
      let x=-1.5;
      if(s===undefined){
        const range=this.config.police.spawn_behind_range_m;
        s=Math.max(0,this.player.s-range[0]-this.rng()*(range[1]-range[0]));
      }
      const road=roadAt(this.track,s),branch=this.player.x>(road.count===2?road.r1:0)?2:1;
      if(road.count===2)x=branch===1?(road.l1+road.r1)/2:(road.l2+road.r2)/2;
      const open=[x,road.count===2?x+1.8:1.5].find(lane=>!this.traffic.some(a=>Math.abs(a.s-s)<10&&Math.abs(a.x-lane)<2));
      if(open===undefined)return false;x=open;
      this.police = {id: 'police', kind: 'police', s, x, v: this.config.police.entry_speed_kmh, lateralV:0, color: '#e78b3f', state: 'riding', recoveryLeft: 0, grace: 0, hitGrace: 0, attackGrace:0, stagger:0, action: null, push: 0, attackTimer: 3, attackIndex: 0, escape: 0, warning: 2, targetId:null, targetHold:0, observeIn:0, desiredX:x, capture:0};
      this.police.branch=branch;this.police.stamina=this.staminaCapacity(this.police);this.emit('pursuit');return true;
    }
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || this.state === 'paused') return;
      this.accumulator += Math.min(dt, .25);
      while (this.accumulator + 1e-9 >= 1/60) { this.step(1/60); this.accumulator -= 1/60; }
    }
    step(dt) {
      const p = this.player;
      this.phaseTime += dt; this.screenFlash = Math.max(0, this.screenFlash-dt);
      if(this.cameraImpulse){this.cameraImpulse.age+=dt;if(this.cameraImpulse.age>=this.cameraImpulse.duration)this.cameraImpulse=null;}
      if (this.state === 'title') {
        this.demoS += 24 * dt; this.viewS = this.demoS; p.x = 0; p.lean = Math.sin(this.demoS / 160) * .05;
        for (const c of this.traffic) { c.s += c.v/3.6*dt; if (c.s < this.demoS-40 || c.s > this.demoS+800) c.s = this.demoS+400+this.rng()*200;this.moveTrafficLane(c,dt); }
        return;
      }
      if (this.state === 'approach') {
        const duration=this.config.race.approach_s,t = clamp(this.phaseTime/duration,0,1); this.viewS = -this.approachDistance*(1-t)*(1-t);
        for(const c of this.traffic){const old=c.s;c.s+=c.v/3.6*dt;this.moveTrafficLane(c,dt);}
        if(this.phaseTime>=1.5)this.traffic=[];
        if (this.phaseTime >= duration) { this.viewS=0;this.state = 'countdown'; this.phaseTime = 0; this.emit('countdown'); }
        return;
      }
      if (this.state === 'countdown') { for(const c of this.traffic)c.s+=c.v/3.6*dt; if (this.phaseTime >= 3) { this.state = 'racing'; this.phaseTime = 0; this.emit('started'); } return; }
      if (this.state === 'arresting') { if (this.phaseTime >= 1) { this.state = 'result'; this.phaseTime = 0; } return; }
      if(this.state==='finishing'){
        if(this.recovery)this.recovery.walking=false;
        const oldV=p.v;p.v=move(p.v,0,600*dt);p.s+=(oldV+p.v)/7.2*dt;p.lean=move(p.lean,0,dt*3);
        this.updateParked(dt);this.viewS=p.s;
        if(this.phaseTime>=1.2&&p.v===0){this.state='result';this.phaseTime=0;}return;
      }
      if (!['racing','recovering'].includes(this.state)) return;
      this.time += dt;
      if(this.impact){this.impact.age+=dt;if(this.impact.age>.55)this.impact=null;}
      this.crashEffects=this.crashEffects.filter(e=>(e.age+=dt)<1.4);
      for(const rider of [p,...this.ai,...(this.police?[this.police]:[])]){rider.oldS=rider.s;rider.oldX=rider.x;const pos=this.personPosition(rider);rider.oldPersonS=pos.s;rider.oldPersonX=pos.x;rider.attackGrace=Math.max(0,(rider.attackGrace||0)-dt);}
      p.grace = Math.max(0,p.grace-dt); p.hitGrace = Math.max(0,p.hitGrace-dt);
      p.stagger=Math.max(0,p.stagger-dt);
      if(!p.action&&(this.input.foot||this.input.hand))this.interact(this.input.foot?'foot':'hand');
      // Apply player contact before movement on the first simulation tick after keydown.
      this.updateActions(dt,Infinity,true);
      const oldS = p.s;
      if (this.state === 'racing') {
        const turn = Number(this.input.right)-Number(this.input.left);let road = this.road;
        let top = this.bike.max_speed_kmh;
        if (surfaceAt(this.track,p.s,p.x,road)!=='road') top = this.bike.offroad_speed_kmh || 70;
        const oldV=p.v;
        p.v = move(p.v,this.input.brake ? 0 : top,(this.input.brake || p.v>top ? this.bike.braking_kmh_per_s : this.bike.acceleration_kmh_per_s)*dt);
        p.s += (oldV+p.v)/7.2*dt;road=roadAt(this.track,p.s);
        const {authority,drift}=steering(this.bike,p.v,road.curve),lateralTarget=turn*authority-drift;
        p.lateralV=move(p.lateralV,lateralTarget,(turn===0?34:p.lateralV*turn<0?32:26)*dt);p.x+=(p.lateralV+p.push)*dt;
        p.push = move(p.push,0,this.config.interaction.push_deceleration_m_per_s2*dt); p.lean = move(p.lean,turn*.45-road.curve*40,dt*3);
        const extra=road.junction?22:0;
        if (p.x<road.left-extra-1.2||p.x>road.right+extra+1.2) { p.x=clamp(p.x,road.left-extra-1.25,road.right+extra+1.25); if(p.v>=50) this.crash('roadside'); else p.v=Math.min(p.v,15); }
      } else {
        const r = this.recovery,complete=this.advanceRecovery(p,dt,this.input),pos=this.personPosition(p);
        p.s=pos.s;p.x=pos.x;
        if(complete){p.stamina=this.config.stamina.capacity;p.x=r.bikeX;p.s=r.bikeS;p.v=0;p.grace=2;this.state='racing';this.recovery=null;this.capture=0;this.clearInput();this.emit('recovered');}
      }
      const grounded=this.state==='racing'||this.state==='recovering'&&['run','mount'].includes(recoveryPose(this.recovery).phase);
      const finishFraction=grounded&&p.s>=this.track.length_m?oldS<this.track.length_m?(this.track.length_m-oldS)/(p.s-oldS):0:Infinity;
      this.updateParked(dt);
      this.updateAI(dt);
      this.updatePolice(dt);
      this.updateRiderContacts(finishFraction);
      this.updateFootContacts(finishFraction);
      this.updateTraffic(dt,oldS,finishFraction);
      this.updateActions(dt,finishFraction);
      if (['racing','recovering'].includes(this.state)) this.updateCapture(dt,finishFraction);
      // Compare events within the fixed step; a later impact cannot undo a finish.
      if ((this.state==='racing'||this.state==='recovering'&&['run','mount'].includes(recoveryPose(this.recovery).phase)) && finishFraction<=1) { p.s=this.track.length_m; this.end('finish'); }
      this.viewS = p.s;
    }
    laneX(a,s,x,branch,r){return x;}
    clearLane(rider,desired){
      const settings=this.config.ai;
      rider.yieldBody=null;let nearestBody=Infinity;
      const speed=rider.v/3.6,bodyAhead=speed*settings.decision_interval_s+speed*speed/(2*Math.max(50,this.aiBike.braking_kmh_per_s)/3.6)+3;
      const racers=[...(['racing','recovering'].includes(this.state)?[this.player]:[]),...this.ai,...(this.police?[this.police]:[])].filter(a=>{
        const valid=a!==rider&&!a.finished&&a.simMode!=='distant'&&(a===this.player||a.state==='riding'||a.state==='recovering');
        const body=valid&&(a===this.player?this.recovery:a.recovery);
        if(body){const pos=this.personPosition(a),px=this.laneX(rider,pos.s,pos.x,a.branch),bx=this.laneX(rider,body.bikeS,body.bikeX,a.branch),near=Math.min(pos.s,body.bikeS)-rider.s,far=Math.max(pos.s,body.bikeS)-rider.s;
          if(far> -3&&near<bodyAhead&&near<nearestBody&&rider.x>Math.min(px,bx)-1&&rider.x<Math.max(px,bx)+1){rider.yieldBody=a;nearestBody=near;}}
        return valid;
      });
      const obstacles=[...this.traffic,...racers],isCar=c=>c.kind==='car'||c.kind==='truck'||!c.kind;
      const ahead=c=>isCar(c)?Math.max(settings.obstacle_lookahead_min_m,settings.obstacle_lookahead_base_m+(rider.v-c.v)/3.6*settings.obstacle_lookahead_s):Math.max(rider.kind==='police'||this.time>=settings.formation_s?8:3,(rider.kind==='police'||this.time>=settings.formation_s?8:3)+(rider.v-c.v)/3.6*1.3);
      const blocked=(c,x)=>{
        const body=!isCar(c)&&(c===this.player?this.recovery:c.recovery),pos=body?this.personPosition(c):c;
        if(body){
          if(rider.kind==='police'&&rider.targetId===c.id)return false;
          const px=this.laneX(rider,pos.s,pos.x,c.branch),bx=this.laneX(rider,body.bikeS,body.bikeX,c.branch),near=Math.min(pos.s,body.bikeS)-rider.s,far=Math.max(pos.s,body.bikeS)-rider.s,left=Math.min(px,bx)-.9,right=Math.max(px,bx)+.9;
          return far> -3&&near<bodyAhead&&x>left&&x<right;
        }
        return pos.s-rider.s>(isCar(c)?-5:2)&&pos.s-rider.s<ahead(c)&&Math.abs(this.laneX(rider,pos.s,pos.x,c.branch)-x)<(isCar(c)?1.45:.9);
      };
      const obstacle=obstacles.find(c=>blocked(c,desired));
      if(!obstacle)return desired;
      const [lo,hi]=this.branchBounds(rider,roadAt(this.track,rider.s));
      const options=[lo,(lo+hi)/2-.7,(lo+hi)/2+.7,hi];
      const open=options.filter(x=>!obstacles.some(c=>blocked(c,x)));
      return open.sort((a,b)=>Math.abs(a-rider.x)-Math.abs(b-rider.x))[0]??rider.x;
    }
    wantsDuel(a,opponent=this.player){
      const frontRunner=opponent===this.player&&this.rank()<=3;
      return this.time>=this.config.ai.formation_s&&opponent&&a.paceTargetId===opponent.id&&(opponent!==this.player||this.state==='racing')&&opponent.v>45&&opponent.grace<=0&&a.aggression>(frontRunner?.28:.38)&&Math.abs(a.s-opponent.s)<this.config.ai.engagement_range_m&&(this.time+(a.pacePhase||0)*5)%(15+(a.pacePeriod||18)*.3)<this.config.ai.engagement_duration_s+(frontRunner?2:0);
    }
    rankPace(a,ahead,behind){
      const settings=this.config.ai,gap=a.s-this.player.s,list=gap>0?ahead:behind,index=list.indexOf(a);
      if(index<0||index>=settings.rank_neighbor_count)return 0;
      return gap>0?-Math.min(settings.rank_slowdown_max_kmh,Math.max(0,gap-35)*.24)/(index+1):Math.min(settings.rank_boost_max_kmh,Math.max(0,-gap-12)*.32)/(index+1);
    }
    rearPace(target,gap){
      const p=this.player;
      return gap<0&&this.state==='racing'&&this.time>=this.config.ai.formation_s&&target>p.v?p.v+(target-p.v)*this.config.ai.rear_closing_scale:target;
    }
    branchBounds(a,r){return [r.left+.8,r.right-.8];}
    routeReachable(a,b){return true;}
    paceTarget(a,gap){
      const cfg=this.config.ai.cohorts[(a.cohort||1)-1],max=this.bike.max_speed_kmh;
      if(a.s/this.track.length_m<cfg.release){a.paceMode='burst';return max*cfg.burst;}
      if(a.s/this.track.length_m>=this.config.ai.final_release){a.paceMode='final';return max*Math.min(cfg.cruise,this.config.ai.final_cruise);}
      a.paceMode='released';return max*cfg.cruise;
    }
    updateAI(dt){
      const p=this.player,cfg=this.config.ai,formation=this.time<cfg.formation_s;
      this.racePaceV??=this.aiBike.max_speed_kmh;if(this.state==='racing')this.racePaceV=clamp(this.racePaceV+(p.v-this.racePaceV)*dt/(cfg.pace_history_s+dt),this.aiBike.max_speed_kmh*cfg.ahead_min_speed_ratio,this.aiBike.max_speed_kmh);
      if(this.aiDecisionAI!==this.ai){this.aiDecisionAI=this.ai;this.aiDecision=0;}this.aiDecision-=dt;
      if(this.aiDecision<=0){
        const sorted=this.ai.filter(a=>!a.finished).sort((a,b)=>b.s-a.s);let rear=0,best;
        sorted.forEach((a,i)=>{a.before=sorted[i-1];a.after=sorted[i+1];if(a.s<p.s){a.rearOrder=++rear;if(a.state==='riding'&&this.routeReachable(a,p)&&(!best||a.s>best.s))best=a;}});
        if(!this.duelBuddy||this.duelBuddy.state!=='riding'||this.duelBuddy.finished||Math.abs(this.duelBuddy.s-p.s)>85||!this.routeReachable(this.duelBuddy,p)||this.time>this.duelUntil){this.duelBuddy=best;this.duelUntil=this.time+6;}this.aiDecision=cfg.decision_interval_s;
      }
      for(const a of this.ai){
        if(a.finished)continue;for(const key of ['grace','hitGrace','stagger','arrestImmune'])a[key]=Math.max(0,(a[key]||0)-dt);
        const gap=a.s-p.s;
        if(a.simMode==='full'&&(gap>cfg.distant_front_m||gap< -cfg.distant_rear_m)){a.simMode='distant';a.action=null;}else if(a.simMode==='distant'&&gap<cfg.reenter_front_m&&gap> -cfg.reenter_rear_m){a.simMode='full';a.decisionIn=0;}
        if(this.updateRecovery(a,dt))continue;
        const road=roadAt(this.track,a.s),[lo,hi]=this.branchBounds(a,road);a.decisionIn=(a.decisionIn||0)-dt;
        if(a.decisionIn<=0){
          let desired=clamp(formation?(a.gridIndex%2?-1.9:1.9):(lo+hi)/2+(a.preferredLane||0)*.55,lo,hi);
          if(this.duelBuddy===a&&!formation&&this.state==='racing'&&Math.abs(gap)<35){const side=a.passSide||1,wanted=p.x+side*1.35;desired=clamp(wanted<lo||wanted>hi?p.x-side*1.35:wanted,lo,hi);}
          const before=a.before;if(!formation&&before?.state==='riding'&&before.s-a.s<16&&Math.abs(before.x-desired)<.9)desired=clamp(before.x+(a.passSide||1)*1.4,lo,hi);
          a.desiredLane=clamp(this.clearLane(a,desired),lo,hi);a.desiredOffset=a.desiredLane-(lo+hi)/2;a.decisionIn=cfg.decision_interval_s;
        }
        const desired=clamp((lo+hi)/2+(a.desiredOffset||0),lo,hi);a.lateralV=move(a.lateralV||0,a.stagger>0?0:clamp((desired-a.x)*3,-4.2,4.2),20*dt);a.x+=(a.lateralV+(a.push||0))*dt;a.push=move(a.push||0,0,14*dt);
        // Player motion has already advanced this fixed step. Aim the arrival
        // controller at the rival's end-of-step gap, not its stale position.
        let target=this.paceTarget(a,gap+a.v/3.6*dt);
        if(a.paceMode!=='burst')target-=Math.min(6,Math.abs(road.curve)*1800);
        if(this.time<(a.launchDelay||0)||a.baseSpeed===0)target=0;
        if(surfaceAt(this.track,a.s,a.x,road)!=='road')target=Math.min(target,this.aiBike.offroad_speed_kmh||70);
        if(a.simMode!=='distant'){
          const body=a.yieldBody,fall=body&&(body===p?this.recovery:body.recovery);
          if(fall){const pos=this.personPosition(body),px=this.laneX(a,pos.s,pos.x,body.branch,road),bx=this.laneX(a,fall.bikeS,fall.bikeX,body.branch,road);if(Math.max(pos.s,fall.bikeS)>a.s-3&&a.x>Math.min(px,bx)-1&&a.x<Math.max(px,bx)+1)target=Math.min(target,Math.sqrt(2*(Math.max(50,this.aiBike.braking_kmh_per_s)/3.6)*Math.max(0,Math.min(pos.s,fall.bikeS)-a.s-2))*3.6);}
          for(const c of this.traffic)if(!c.crossing&&c.s>a.s&&c.s-a.s<25&&Math.abs(this.laneX(a,c.s,c.x,c.branch,road)-a.x)<1.35)target=Math.min(target,Math.max(0,c.v));
          a.attackTimer-=dt;
          if(!formation&&a.stagger<=0&&a.attackTimer<=0&&!a.action){
            let opponent;if(this.state==='racing'&&p.grace<=0&&p.attackGrace<=0&&Math.abs(gap)<3.4&&Math.abs(p.x-a.x)<2.25)opponent=p;
            else opponent=[a.before,a.after].find(r=>r&&r.state==='riding'&&!r.finished&&Math.abs(r.s-a.s)<2.8&&Math.abs(r.x-a.x)<2.1);
            if(opponent){const weapon=a.weapon;a.action={kind:weapon||(a.aggression>.58?'foot':'hand'),weapon,age:0,windup:.32,targetId:opponent.id,side:Math.sign(opponent.x-a.x)||1,hit:false};a.attackTimer=cfg.interaction_retry_range_s[0]+this.rng()*(cfg.interaction_retry_range_s[1]-cfg.interaction_retry_range_s[0]);this.emit('rider_attack',{attacker:a.id,target:opponent.id});}
          }
        }
        a.v=move(a.v,clamp(target,0,this.bike.max_speed_kmh*1.08),(a.v>target?Math.max(50,this.aiBike.braking_kmh_per_s):a.acceleration||22)*dt);a.s+=a.v/3.6*dt;const bounds=road;
        if(a.simMode!=='distant'&&!formation){a.historyTime=(a.historyTime||6)+dt;a.historyDistance=(a.historyDistance||0)+a.v/3.6*dt;}
        if(a.s>=this.track.length_m)this.parkRider(a);else if(a.x<bounds.left-1.2||a.x>bounds.right+1.2)this.crashRider(a,'roadside');
      }
    }
    updateRiderContacts(finishFraction){
      const p=this.player,riders=[p,...this.ai,...(this.police?[this.police]:[])];
      const riding=r=>r===p?this.state==='racing':r.state==='riding'&&!r.finished&&r.simMode!=='distant';
      for(let i=0;i<riders.length;i++)for(let j=i+1;j<riders.length;j++){
        const a=riders[i],b=riders[j];
        if(!riding(a)||!riding(b)||a.grace>0||b.grace>0||a.hitGrace>0||b.hitGrace>0)continue;
        const fraction=contactFraction((a.oldS??a.s)-(b.oldS??b.s),a.s-b.s,2);
        if(fraction>1||Math.abs(a.x-b.x)>=.75||((a===p||b===p)&&fraction>=finishFraction))continue;
        const side=Math.sign(a.x-b.x)||1;a.push=side*2.8;b.push=-side*2.8;a.hitGrace=.5;b.hitGrace=.5;
        if(Math.abs(a.v-b.v)>=35){this.crashRider(a,'rider');this.crashRider(b,'rider');}
        else{const damage=8+Math.abs(a.v-b.v)*.4;this.damage(a,damage,'rider');this.damage(b,damage,'rider');this.emit('rider_contact',{target:b.id});}
      }
    }

    crossingWait(s,start,speed,wait){
      const intervals=[];
      for(const c of this.traffic){
        if(c.crossing)continue;
        if(Math.abs(c.v)<1){if(Math.abs(c.s-s)<6)return null;continue;}
        const eta=(s-c.s)/(c.v/3.6);if(eta<0)continue;
        const x=c.direction?this.trafficLane(s,c.direction,c.laneIndex):c.x;
        const travel=Math.abs(x-start)/speed,half=(c.kind==='truck'?3.5:2.25)/Math.abs(c.v/3.6)+(2.25+(c.kind==='truck'?1.15:.9))/speed+this.config.traffic.crossing_clearance_s;
        intervals.push([eta-travel-half,eta-travel+half]);
      }
      intervals.sort((a,b)=>a[0]-b[0]);for(const [lo,hi]of intervals)if(wait>=lo&&wait<=hi)wait=hi+.05;
      return wait;
    }
    trafficCrossingClear(car){
      for(const c of this.traffic){if(!c.crossing||!car.v)continue;
        const eta=(c.s-car.s)/(car.v/3.6);if(eta<0)continue;
        const lane=car.direction?this.trafficLane(c.s,car.direction,car.laneIndex):car.x;
        const crossing=(lane-c.x)/c.vx+Math.max(0,c.departAt-this.time);
        const half=(car.kind==='truck'?3.5:2.25)/Math.abs(car.v/3.6)+(2.25+(car.kind==='truck'?1.15:.9))/Math.abs(c.vx)+this.config.traffic.crossing_clearance_s;
        if(Math.abs(eta-crossing)<=half)return false;
      }return true;
    }
    updateTraffic(dt, oldPlayerS, finishFraction) {
      const p=this.player;
      for(const c of this.traffic){
        const old=c.s,oldX=c.x;
        if(c.crossing){if(this.time>=c.departAt)c.x+=c.vx*dt;}else{c.s+=c.v/3.6*dt;this.moveTrafficLane(c,dt);}
        for(const r of [p,...this.ai,...(this.police?[this.police]:[])]){
          if(r.simMode==='distant'||r.finished)continue;
          const body=r===p?this.recovery:r.recovery,pos=this.personPosition(r),hs=(c.crossing?.9:c.kind==='truck'?3.5:2.25)+(body?.35:1),hx=(c.crossing?2.25:c.kind==='truck'?1.15:.9)+(body?.25:.4);
          const f=sweptContact(old-(r.oldPersonS??r.oldS??pos.s),oldX-(r.oldPersonX??r.oldX??pos.x),c.s-pos.s,c.x-pos.x,hs,hx);
          if(f>1||(r===p&&f>=finishFraction))continue;
          if(body){this.hitOnFoot(r,c,'traffic');continue;}
          if((r===p?this.state!=='racing':r.state!=='riding')||r.grace>0||r.hitGrace>0)continue;
          const x0=oldX-(r.oldX??pos.x),x1=c.x-pos.x,overlap=hx-Math.abs(x0+(x1-x0)*f),relative=Math.hypot(r.v-c.v,(c.vx||0)*3.6);
          if(relative>=this.config.stamina.severe_relative_speed_kmh&&(!c.crossing||Math.abs((old-(r.oldS??pos.s))*(1-f)+(c.s-pos.s)*f)<hs*.85)&&(!c.crossing&&overlap>=.2||c.crossing))this.crashRider(r,'traffic');
          else{this.damage(r,Math.min(75,this.config.stamina.car_glance_damage+relative*.55),'traffic');r.v=Math.max(0,Math.min(r.v-10,Math.max(25,c.v+10)));r.push=(Math.sign(r.x-c.x)||1)*2;r.hitGrace=.5;this.emit('scrape',{id:r.id});}
        }
      }
      // Keep rear traffic while a pursuing rider is there, so it cannot phase through a despawn.
      const racers=[p,...this.ai.filter(a=>!a.finished&&a.simMode!=='distant')],rear=Math.min(...racers.map(a=>a.s))-65;
      const front=Math.max(...racers.map(a=>a.s));
      this.traffic=this.traffic.filter(c=>c.s>Math.min(rear,this.police?this.police.s-45:rear)&&c.s<front+1000&&(!c.crossing||(c.vx>0?c.x<=c.endX:c.x>=-c.endX)));
      this.crossingDecision-=dt;
      if(this.allowRandomTraffic&&this.crossingDecision<=0){
        this.crossingDecision=this.config.ai.decision_interval_s;
        for(const [i,crossS]of(this.track.crossings||[]).entries()){
          if(!this.crossingUsed.has(i)&&crossS-p.s<clamp(p.v/3.6*10,220,440)&&crossS-p.s>35&&this.traffic.filter(c=>c.crossing).length<2){
            const road=roadAt(this.track,crossS),dir=(i+1+this.seed)%2===0?1:-1,start=dir===1?road.left-18:road.right+18,speed=8.3,arrival=Math.max(2,(crossS-p.s)/Math.max(15,p.v/3.6));
            let wait=this.crossingWait(crossS,start,speed,Math.max(0,arrival-Math.abs(start)/speed));
            if(wait!==null&&wait>arrival-1)wait=this.crossingWait(crossS,start,speed,0);
            if(wait!==null&&wait<=arrival-1){this.traffic.push({id:'crossing_'+(i+1),kind:'car',color:'#c8d5cf',crossing:true,s:crossS,x:start,v:0,vx:dir*speed,departAt:this.time+wait,entryAt:this.time+wait,endX:Math.max(Math.abs(road.left),Math.abs(road.right))+23});this.crossingUsed.add(i);this.emit('crossing_scheduled',{index:i+1,s:crossS,wait});}
          }
        }
      }
      this.nextTraffic-=dt;
      if(this.allowRandomTraffic&&!this.openingTrafficIssued&&this.time>=this.config.traffic.opening_wave_s&&p.s<this.track.length_m-150){
        this.openingTrafficIssued=true;
        for(const [distance,direction,speed] of [[110,1,52],[220,-1,58],[380,1,65]]){
          const c=this.makeTraffic(p.s+distance);Object.assign(c,{opening:true,bornAt:this.time,direction,v:direction*speed,x:this.trafficLane(c.s,direction,c.laneIndex)});this.traffic.push(c);
        }
        this.nextTraffic=this.track.traffic_gap_s[0];
      }
      if(this.allowRandomTraffic&&this.nextTraffic<=0&&p.s<this.track.length_m-150){
        const range=this.track.traffic_gap_s;this.nextTraffic=range[0]+this.rng()*(range[1]-range[0]);
        // Supply every separated pack, rather than giving distant leaders an empty road.
        const anchors=[p.s];
        for(const r of racers.toSorted((a,b)=>a.s-b.s))if(anchors.every(s=>Math.abs(r.s-s)>this.config.traffic.pack_spacing_m))anchors.push(r.s);
        for(const anchor of anchors){
          if(anchor>=this.track.length_m-150)continue;
          let position=anchor+this.config.traffic.minimum_spawn_ahead_m+this.rng()*120;
          if(position>this.viewS-80&&position<this.viewS+this.config.traffic.max_visible_m+100)position=this.viewS+this.config.traffic.max_visible_m+120+this.rng()*120;
          const c=this.makeTraffic(position);
          if(this.traffic.filter(v=>Math.abs(v.s-anchor)<500).length<this.config.traffic.max_active_near_player&&!this.traffic.some(v=>Math.abs(v.s-c.s)<this.config.traffic.minimum_spawn_separation_m)&&this.trafficCrossingClear(c))this.traffic.push(c);
        }
      }
    }
    updateFootContacts(finishFraction=Infinity){
      const p=this.player,all=[p,...this.ai,...(this.police?[this.police]:[])];
      for(const person of all){
        if(person.simMode==='distant')continue;
        if(person===p?this.state!=='recovering':person.state!=='recovering')continue;
        const pos=this.personPosition(person);
        for(const bike of all){
          if(bike===person||bike.simMode==='distant'||(bike===p?this.state!=='racing':bike.state!=='riding'||bike.finished)||bike.v<25)continue;
          const fraction=contactFraction((bike.oldS??bike.s)-(person.oldS??pos.s),bike.s-pos.s,1.25);
          if(Math.abs(bike.x-pos.x)<.7&&fraction<=1&&(person!==p||fraction<finishFraction))this.hitOnFoot(person,bike,'rider');
        }
      }
    }

    updateActions(dt, finishFraction, playerOnly=false) {
      const p=this.player;
      for(const a of (playerOnly?[p]:[...this.ai,...(this.police?[this.police]:[])])){
        if(!a.action||(a!==p&&(a.finished||a.state!=='riding')))continue;
        const act=a.action,oldAge=act.age,w=act.weapon&&this.config.weapons[act.weapon];act.age+=dt;
        const windup=act.windup??(a.kind==='police'?this.config.police.attack_windup_s:.32);
        if(!act.hit&&act.age>=windup){
          act.hit=true;
          const target=act.targetId==='player'?p:[...this.ai,...(this.police?[this.police]:[])].find(t=>t.id===act.targetId);
          const range=this.attackRange(act.kind,act.weapon);
          const valid=target&&(target===p?this.state==='racing':target.state==='riding')&&Math.abs(target.s-a.s)<=range.s&&Math.abs(target.x-a.x)<=range.x&&target.grace<=0&&!(target.attackGrace>0);
          if(valid&&Math.max(0,(windup-oldAge)/dt)<finishFraction){
            const side=Math.sign(target.x-a.x)||act.side;
            target.attackGrace=this.config.interaction.victim_rehit_grace_s;target.hitGrace=.1;target.stagger=target.kind==='police'?this.config.interaction.pursuer_stagger_s:target===p?.16:.65;target.action=null;
            target.lateralV=0;
            if(target.kind==='rider'){target.rivalId=a.id;target.reactUntil=this.time+this.config.ai.local_reaction_memory_s;target.decisionIn=0;}
            target.attackTimer=Math.max(target.attackTimer||0,2);target.observeIn=Math.max(target.observeIn||0,1.2);
            if(act.kind==='hand'&&!a.weapon&&target.weapon){a.weapon=target.weapon;target.weapon=null;if(this.tour)this.tour.weapon=this.player.weapon;this.emit('weapon_stolen',{attacker:a.id,target:target.id,weapon:a.weapon});}
            this.damage(target,w?w.damage:this.config.stamina[act.kind+'_damage'],act.kind);
            {target.push=side*(w?w.push_speed_m_per_s:act.kind==='foot'?this.config.interaction.foot_push_speed_m_per_s:this.config.interaction.hand_push_speed_m_per_s);target.v=Math.max(0,target.v-(w?w.speed_loss_kmh:act.kind==='foot'?this.config.interaction.foot_speed_loss_kmh:this.config.interaction.hand_speed_loss_kmh));}
            this.setImpact({age:0,kind:act.kind,side,s:target.s,x:target.x,strength:act.kind==='foot'?1:.65},a===p||target===p);
            this.emit('hit',{attacker:a.id,target:target.id,kind:act.kind});
          }else if(a===p)this.emit('miss',{kind:act.kind});
        }
        if(act.age>=windup+(w?w.recovery_s:this.config.interaction[(act.kind==='foot'?'foot':'hand')+'_recovery_s']))a.action=null;
      }
    }
    targetById(id){return id==='player'?this.player:this.ai.find(a=>a.id===id);}
    targetAvailable(target){return target&&(target===this.player?['racing','recovering'].includes(this.state):!target.finished&&target.state!=='detained'&&!(target.arrestImmune>0));}
    personPosition(target){
      const r=target===this.player?this.recovery:target.recovery;
      if(r){const pose=recoveryPose(r);return {s:r.bikeS+pose.offset,x:pose.x??r.bikeX+r.side*.6,recovering:true,height:pose.height};}
      return {s:target.s,x:target.x,recovering:false,height:0};
    }

    updatePolice(dt) {
      const p=this.player,settings=this.config.police;
      if(!this.police&&this.allowPatrols&&this.time>=settings.onboarding_protection_s&&p.s<this.track.length_m-150){
        this.track.patrol_windows_m.forEach((w,i)=>{
          const used=this.patrolDispatches.get(i)||0,budget=i===0?settings.first_zone_dispatches:1;
          if(!this.police&&used<budget&&this.time-this.lastPatrolTime>=settings.dispatch_interval_s&&p.s>=w[0]&&p.s<=w[1]&&this.spawnPolice()){
            this.patrolUsed.add(i);this.patrolDispatches.set(i,used+1);this.lastPatrolTime=this.time;
          }
        });
      }
      const c=this.police;if(!c)return;
      c.oldS??=c.s;c.grace=Math.max(0,c.grace-dt);c.hitGrace=Math.max(0,c.hitGrace-dt);c.warning=Math.max(0,c.warning-dt);c.stagger=Math.max(0,(c.stagger||0)-dt);
      if(this.updateRecovery(c,dt)){c.capture=0;this.capture=0;return;}
      c.targetHold+=dt;c.observeIn-=dt;c.attackTimer-=dt;
      let target=this.targetById(c.targetId);
      if(target&&(!this.targetAvailable(target)||!this.routeReachable(c,target)))c.observeIn=0;
      if(c.observeIn<=0&&c.stagger<=0){
        c.observeIn=settings.observation_interval_s;
        const ranked=[p,...this.ai].filter(a=>this.targetAvailable(a)).sort((a,b)=>b.s-a.s);
        const reachable=ranked.filter(a=>a.s-c.s>-35&&a.s-c.s<settings.reachable_front_m&&this.routeReachable(c,a));
        const frontRunners=reachable.filter(a=>ranked.indexOf(a)<settings.priority_front_count);
        const candidates=frontRunners.length?frontRunners:reachable;
        const stopped=reachable.find(a=>Math.abs(this.personPosition(a).s-c.s)<6&&(a.v<=18||this.personPosition(a).recovering));
        const leftFront=target&&(ranked.indexOf(target)>=settings.priority_front_count||target.s<c.s-10);
        if(!this.targetAvailable(target)||!this.routeReachable(c,target)||Math.abs(target.s-c.s)>settings.reachable_front_m||c.targetHold>=settings.target_hold_s&&leftFront){
          const chosen=stopped||candidates[0];
          if((chosen?.id??null)!==c.targetId){c.targetId=chosen?.id??null;c.targetHold=0;c.capture=0;this.capture=0;this.emit('pursuit_target',{target:c.targetId});}
          target=chosen;
        }
        if(target){const pos=this.personPosition(target),tx=this.laneX(c,pos.s,pos.x,target.branch);const side=c.x>tx?1:-1;const [lo,hi]=this.branchBounds(c,roadAt(this.track,c.s)),offset=pos.recovering||target.v<=18?.8:1.15,wanted=tx+side*offset;c.desiredX=this.clearLane(c,wanted<lo||wanted>hi?tx-side*offset:wanted);}
        else{const [lo,hi]=this.branchBounds(c,roadAt(this.track,c.s));c.desiredX=(lo+hi)/2;}
        c.justMerged=false;
      }
      if(!this.targetAvailable(target)||!this.routeReachable(c,target))target=null;
      const pos=target?this.personPosition(target):{s:c.s+80,x:c.x,recovering:false};
      // Draw alongside a moving rider, instead of asymptotically following just behind it.
      const gap=pos.s+(target&&!pos.recovering&&target.v>18?1.5:0)-c.s;
      let targetV=target?clamp(target.v+gap*.8,0,settings.chase_max_speed_kmh):105;
      if(target&&(pos.recovering||target.v<=18))targetV=Math.min(targetV,Math.sqrt(Math.max(0,gap-1)*2*(50/3.6))*3.6);
      if(c.stagger>0)targetV=Math.min(targetV,c.v);
      if(this.traffic.some(v=>v.s-c.s>0&&v.s-c.s<25&&Math.abs(this.laneX(c,v.s,v.x,v.branch)-c.x)<1.3))targetV=Math.min(targetV,40);
      for(const rider of [p,...this.ai])if(rider.s-c.s>0&&rider.s-c.s<12&&Math.abs(rider.x-c.x)<.9&&rider.v<c.v)targetV=Math.min(targetV,rider.v);
      c.v=move(c.v,targetV,(c.v>targetV?settings.braking_kmh_per_s:settings.acceleration_kmh_per_s)*dt);const priorS=c.s;c.s+=c.v/3.6*dt;
      const chaseRoad=roadAt(this.track,c.s),[lo,hi]=this.branchBounds(c,chaseRoad);c.desiredX=clamp(c.desiredX,lo,hi);
      c.lateralV=move(c.lateralV||0,c.stagger>0?0:clamp((c.desiredX-c.x)*2.5,-4.2,4.2),20*dt);
      c.x+=(c.lateralV+c.push)*dt;c.push=move(c.push,0,this.config.interaction.push_deceleration_m_per_s2*dt);
      if(surfaceAt(this.track,c.s,c.x,chaseRoad)!=='road')c.v=Math.min(c.v,this.aiBike.offroad_speed_kmh||70);
      if(c.x<chaseRoad.left-1.2||c.x>chaseRoad.right+1.2){this.crashRider(c,'roadside');c.capture=0;this.capture=0;return;}
      if(target&&!pos.recovering&&target.v>18&&c.warning<=0&&c.stagger<=0&&c.attackTimer<=0&&Math.abs(c.s-target.s)<3.4&&Math.abs(c.x-target.x)<2.1&&!c.action){
        const kind=['hand','foot','bat'][c.attackIndex++%3];c.action={kind,age:0,windup:settings.attack_windup_s,hit:false,targetId:target.id,side:Math.sign(target.x-c.x)||1};c.attackTimer=settings.attack_cooldown_s;this.emit('pursuer_attack',{kind,target:target.id});
      }
      // An offscreen patrol must not stay with distant stragglers forever and block later patrols.
      const contenders=[p,...this.ai.filter(a=>!a.finished)].sort((a,b)=>b.s-a.s).slice(0,settings.priority_front_count);
      const nearest=Math.min(...[p,...contenders].map(a=>Math.abs(a.s-c.s)));
      if(nearest>settings.escape_distance_m&&c.s<p.s-settings.escape_distance_m)c.escape+=dt;else c.escape=0;
      if(c.escape>=settings.escape_hold_s){this.police=null;this.capture=0;this.emit('pursuit_escaped');}
    }
    updateCapture(dt,finishFraction){
      const c=this.police;if(!c||c.state!=='riding'){this.capture=0;return;}
      const target=this.targetById(c.targetId);if(!this.targetAvailable(target)){c.capture=0;this.capture=0;return;}
      const pos=this.personPosition(target),recovering=pos.recovering,mode=`${target.id}:${recovering?'recovering':'riding'}`;
      if(c.captureMode!==mode){c.capture=target===this.player?this.capture:0;c.captureMode=mode;}
      const close=Math.abs(c.s-pos.s)<=3&&Math.abs(c.x-pos.x)<=1.8;
      if(close&&(recovering||target.v<=18)&&target.grace<=0&&c.warning<=0&&c.v<=this.config.police.capture_own_max_speed_kmh&&c.stagger<=0&&pos.height<.5)c.capture+=dt;else c.capture=0;
      this.capture=target===this.player?c.capture:0;
      const hold=recovering?.6:2;
      if(c.capture+1e-9>=hold){
        if(target===this.player){if((hold-(c.capture-dt))/dt<finishFraction-1e-7)this.end('arrest');}
        else {target.state='detained';target.recovery=null;target.recoveryLeft=this.config.police.opponent_detention_s;target.v=0;target.action=null;target.arrestImmune=10;c.targetId=null;c.targetHold=0;c.capture=0;c.attackTimer=3;c.observeIn=1;this.emit('rider_arrested',{target:target.id});}
      }
    }


  }
  return {Game, roadAt, terrainAt, recoveryPose, clamp, random, surfaceAt, steering, sweptContact, cameraAt,crossingDistance};
});
