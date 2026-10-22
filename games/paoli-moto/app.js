(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('world'), ctx = canvas.getContext('2d');
  const game = new RR.Game(RR_CONFIG);
  for(let i=0;i<=36;i++){
    const angle=(-120+i*240/36)*Math.PI/180,outer=72,inner=i%3===0?61:66;
    const tick=document.createElementNS('http://www.w3.org/2000/svg','line');
    tick.setAttribute('x1',90+Math.sin(angle)*inner);tick.setAttribute('y1',90-Math.cos(angle)*inner);
    tick.setAttribute('x2',90+Math.sin(angle)*outer);tick.setAttribute('y2',90-Math.cos(angle)*outer);
    if(i>29)tick.setAttribute('stroke','#f26e4c');$('dialTicks').appendChild(tick);
  }
  const W = 1280, H = 720;
  const theme = {
    peninsula: {sky:['#557fc5','#b2d3de'],ground:'#748047',grass:'#78864d',far:'#728caa',near:'#4f6b61',road:'#55545b'},
    valley: {sky:['#677fba','#d6c6a1'],ground:'#8b853f',grass:'#918946',far:'#93909a',near:'#666e52',road:'#55515a'},
    coast: {sky:['#5078b3','#c7d7de'],ground:'#7a8252',grass:'#80865a',far:'#7888a2',near:'#525f6c',road:'#4f515b'}
  };
  let last = performance.now(), lastState = '', lastEvent = 0, modalFocus = null, held = new Map();
  const mobileDevice=Boolean(navigator.userAgentData?.mobile||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  let gamepadButtons=[],inputMode=mobileDevice?'touch':'desktop';
  $('stage').dataset.input=inputMode;
  let audio = null, soundOn = false, engineOsc = null, engineGain = null;
  const tickSamples = [], workSamples=[];
  const poly = (c, points, color) => { c.fillStyle=color;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill(); };
  function line(c,points,color,width=2) {c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}
  function ellipse(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
  // The world is rasterized at 640 x 360; menus and instrument labels stay crisp.
  canvas.width=640;canvas.height=360;
  const noiseCanvas=document.createElement('canvas');noiseCanvas.width=noiseCanvas.height=96;
  const nc=noiseCanvas.getContext('2d'),noise=RR.random(1996);
  for(let i=0;i<1800;i++){nc.fillStyle=noise()>.5?'#fff2':'#0002';nc.fillRect(Math.floor(noise()*96),Math.floor(noise()*96),1,1);}
  const asphalt=ctx.createPattern(noiseCanvas,'repeat');
  // Original procedural facade textures: no extracted game artwork is distributed.
  const facades=Array.from({length:8},(_,index)=>{
    const c=document.createElement('canvas');c.width=128;c.height=192;
    const g=c.getContext('2d');
    const walls=['#a7a38b','#a2a8a0','#9f8771','#b3ada3','#8e999e','#b7af91','#887e74','#aaa68e'];
    g.fillStyle=walls[index];g.fillRect(0,0,128,192);
    g.fillStyle=['#343e45','#4c595e','#373e3d'][index%3];
    for(let floor=0;floor<3;floor++)g.fillRect(10,19+floor*45,108,27);
    g.fillStyle=walls[index];
    for(let column=0;column<3;column++)g.fillRect(28+column*30,19,12,117);
    g.fillStyle=['#455b63','#6d4540','#716c50','#4e6558'][index%4];g.fillRect(0,150,128,42);
    return c;
  });
  function texturedFace(texture,points,u0=0,u1=1){
    const [tl,tr,br,bl]=points,lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    function triangle(src,dst){
      const [a,b,c]=src,[p,q,r]=dst,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
      const aa=((q[0]-p[0])*(c[1]-a[1])-(r[0]-p[0])*(b[1]-a[1]))/den;
      const bb=((q[1]-p[1])*(c[1]-a[1])-(r[1]-p[1])*(b[1]-a[1]))/den;
      const cc=((r[0]-p[0])*(b[0]-a[0])-(q[0]-p[0])*(c[0]-a[0]))/den;
      const dd=((r[1]-p[1])*(b[0]-a[0])-(q[1]-p[1])*(c[0]-a[0]))/den;
      ctx.save();ctx.beginPath();dst.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.clip();
      ctx.transform(aa,bb,cc,dd,p[0]-aa*a[0]-cc*a[1],p[1]-bb*a[0]-dd*a[1]);ctx.drawImage(texture,0,0);ctx.restore();
    }
    for(let i=0;i<4;i++){
      const u=i/4,v=(i+1)/4,a=lerp(tl,tr,u),b=lerp(tl,tr,v),c=lerp(bl,br,v),d=lerp(bl,br,u),x=(u0+(u1-u0)*u)*128,y=(u0+(u1-u0)*v)*128;
      triangle([[x,0],[y,0],[y,192]],[a,b,c]);triangle([[x,0],[y,192],[x,192]],[a,c,d]);
    }
  }
  function building(s,side,index){
    if((game.track.crossings||[]).some(c=>s<c+8&&s+16>c-8))return;
    const r=RR.roadAt(game.track,s),z=s-game.viewS+7,x=(side<0?r.left:r.right)+side*(r.sidewalk+.4);
    const span=RoadView.buildingSpan(z);if(!span)return;
    const near=project(span.near,x),far=project(span.far,x),outer=project(span.near,x+side*7),height=7+(index%4)*1.8;
    const top=q=>[q.x,q.y-height*q.scale],bottom=q=>[q.x,q.y];
    if(Math.min(near.x,far.x)>W+80||Math.max(near.x,far.x)<-80)return;
    if(z>=3){texturedFace(facades[(index+3)%facades.length],[top(outer),top(near),bottom(near),bottom(outer)]);poly(ctx,[bottom(near),bottom(outer),top(outer),top(near)],'#20242a44');}
    texturedFace(facades[index%facades.length],[top(near),top(far),bottom(far),bottom(near)],span.u);
  }
  function extension(action){
    if(!action)return 0;const w=action.windup??.12,t=action.age;
    if(w===0)return t<.05?1:Math.max(0,1-(t-.05)/(action.kind==='foot'?.25:.17))**2;
    if(t<w-.05)return -.18*Math.sin(t/w*Math.PI);
    if(t<w+.04)return RR.clamp((t-w+.05)/.09,0,1);
    return Math.max(0,1-(t-w-.04)/(action.kind==='foot'?.30:.22))**2;
  }
  function bike(c,x,y,size,color,lean=0,action=null,style='sport',chaser=false,rider=true,skin=null) {
    c.save();c.translate(x,y);c.scale(size/100,size/100);
    ellipse(c,0,2,34,7,'#10121d88');c.rotate(lean*.48);
    const ext=extension(action),side=action?.side||1,bodyWidth=chaser?32:style==='trail'?18:25;
    ellipse(c,0,-26,13,29,'#080b13');ellipse(c,-3,-26,5,24,'#33343c');
    for(let j=0;j<7;j++)line(c,[[-8,-47+j*7],[8,-45+j*7]],'#53535a',1.5);
    line(c,[[-9,-7],[-19,-61],[20,-61],[9,-7]],'#1c202b',7);
    line(c,[[-9,-12],[-16,-57]],'#b7bdc4',3);line(c,[[9,-12],[16,-57]],'#b7bdc4',3);
    poly(c,[[-bodyWidth,-39],[-bodyWidth-5,-74],[-17,-93],[17,-93],[bodyWidth+5,-74],[bodyWidth,-39]],'#151c2a');
    poly(c,[[-bodyWidth+3,-42],[-bodyWidth-2,-76],[-10,-94],[14,-94],[bodyWidth+2,-70],[bodyWidth-3,-42]],color);
    poly(c,[[-bodyWidth,-43],[-17,-67],[19,-67],[bodyWidth,-43]],'#111723');
    line(c,[[-21,-49],[-15,-80]],'#fff7',3);line(c,[[24,-21],[30,-39],[27,-56]],'#262a34',9);
    line(c,[[24,-21],[29,-36]],'#bfc3c4',5);ellipse(c,24,-21,5,3,'#12131a');
    c.fillStyle='#170f15';c.fillRect(-17,-46,34,11);c.fillStyle='#e53626';c.fillRect(-15,-45,30,6);c.fillStyle='#ff9b64';c.fillRect(-13,-45,25,2);
    c.fillStyle='#d1d1bd';c.fillRect(-10,-34,20,10);c.fillStyle='#474643';c.fillRect(-7,-31,14,3);
    line(c,[[-35,-83],[-23,-88],[24,-88],[35,-83]],'#aeb5bc',4);
    for(const s of [-1,1]){line(c,[[s*30,-86],[s*38,-105]],'#333b48',3);ellipse(c,s*39,-106,8,4,'#bbc6cc');}
    if(chaser){
      // Wide orange racing cowl and twin exhausts identify the pursuer without police insignia.
      for(const s of [-1,1]){
        poly(c,[[s*20,-38],[s*39,-42],[s*42,-64],[s*26,-75]],'#ee8b24');
        line(c,[[s*25,-46],[s*36,-52],[s*29,-59]],'#24252a',6);
        line(c,[[s*29,-20],[s*33,-35]],'#bdc1c3',7);
      }
      poly(c,[[-27,-93],[-26,-115],[26,-115],[27,-93]],'#b0d2cf88');
    }
    if(rider){
      const suit=skin?.suit||(chaser?'#b95d26':'#a62429'),light=skin?.trim||(chaser?'#edaa51':'#e35846'),pants=skin?.pants||'#2a3d66';
      for(const s of [-1,1]){
        const kicking=action?.kind==='foot'&&s===side;
        const knee=[s*(23+(kicking?ext*18:0)),-62-(kicking?ext*8:0)],foot=[s*(25+(kicking?ext*53:0)),-30-(kicking?ext*30:0)];
        line(c,[[s*12,-83],knee,foot],'#111a30',16);line(c,[[s*12,-83],knee,[foot[0],foot[1]-7]],pants,11);line(c,[foot,[foot[0]+s*10,foot[1]+3]],'#0c111c',11);
        line(c,[[s*19,-76],[s*23,-59]],'#637495',2);
      }
      c.save();c.translate(ext*side*5,-Math.abs(ext)*2);c.rotate(ext*side*.11);
      poly(c,[[-22,-84],[-27,-113],[-16,-128],[15,-128],[27,-113],[22,-84]],'#251923');
      poly(c,[[-18,-85],[-24,-113],[-13,-124],[14,-124],[23,-111],[18,-85]],suit);
      line(c,[[-19,-114],[-12,-119],[13,-119],[21,-112]],light,5);
      if(skin?.pattern===1){line(c,[[-12,-117],[13,-91]],light,9);line(c,[[13,-117],[-12,-91]],light,4);}
      else {poly(c,[[-14,-112],[-11,-94],[10,-91],[15,-110]],'#171c2c');line(c,[[-8,-110],[8,-110]],light,4);}
      if(chaser){line(c,[[-15,-111],[0,-102],[15,-111]],'#ffc34e',6);line(c,[[-14,-100],[0,-91],[14,-100]],'#ee8b24',5);}
      line(c,[[-16,-88],[15,-88]],'#141822',4);
      for(const s of [-1,1]){
        const striking=action&&action.kind!=='foot'&&s===side;
        const elbow=[s*(30+(striking?ext*14:0)),-105-(striking?ext*12:0)],hand=[s*(33+(striking?ext*49:0)),-85-(striking?ext*32:0)];
        line(c,[[s*20,-116],elbow,hand],'#281d29',13);line(c,[[s*20,-116],elbow,hand],suit,9);
        line(c,[[s*22,-116],elbow],light,3);ellipse(c,hand[0],hand[1],6,5,'#141723');
        if(striking&&action.kind==='bat')line(c,[hand,[hand[0]+s*(16+ext*24),hand[1]-40+ext*30]],'#d6b47c',7);
        if(striking&&action.kind==='chain')line(c,[hand,[hand[0]+s*(18+ext*19),hand[1]-10+ext*7],[hand[0]+s*(30+ext*32),hand[1]+12-ext*8]],'#bcc8ca',5);
      }
      ellipse(c,0,-133,12,14,'#101722');ellipse(c,-1,-136,11,12,skin?.helmet||(chaser?'#d49839':'#d1d4d6'));
      poly(c,[[-12,-140],[-7,-146],[6,-146],[10,-139],[9,-133],[-11,-133]],skin?.helmet||(chaser?'#eac461':'#f0eded'));
      line(c,[[-10,-132],[8,-132]],'#3b4052',3);line(c,[[-3,-144],[4,-142]],'#fff',2);c.restore();
      if(action&&ext>.55){for(let j=0;j<3;j++)line(c,[[side*(39+j*6),-97+j*9],[side*(58+ext*24+j*5),-104+j*9]],'#fff3bc77',2);}
    }
    c.restore();
  }
  function car(c,x,y,size,obj) {
    c.save();c.translate(x,y);c.scale(size/100,size/100);
    if(obj.crossing){
      if(obj.vx<0)c.scale(-1,1);ellipse(c,0,1,115,9,'#15292566');
      poly(c,[[-112,-8],[-110,-32],[-67,-42],[-38,-72],[43,-72],[74,-43],[106,-32],[112,-8]],obj.color);
      poly(c,[[-56,-42],[-31,-66],[2,-66],[2,-42]],'#557780');poly(c,[[10,-66],[39,-66],[63,-42],[10,-42]],'#557780');
      c.fillStyle='#c6cfca';c.fillRect(-106,-11,211,6);c.fillStyle='#f5e8b5';c.fillRect(98,-28,10,9);c.fillStyle='#db7650';c.fillRect(-111,-28,9,10);
      for(const x of [-69,70]){ellipse(c,x,-7,23,23,'#1b2028');ellipse(c,x,-7,12,12,'#a7afbb');ellipse(c,x,-7,5,5,'#38454a');}
      c.fillStyle='#b6c7d9';c.fillRect(14,-38,15,3);c.restore();return;
    }
    ellipse(c,0,2,62,11,'#15292566');
    const truck=obj.kind==='truck',front=obj.v<0;
    c.fillStyle='#253330';c.fillRect(-51,-30,15,32);c.fillRect(36,-30,15,32);
    poly(c,[[-57,-12],[-57,-63],[-39,truck?-123:-93],[39,truck?-123:-93],[57,-63],[57,-12]],obj.color);
    poly(c,[[-41,-63],[-31,truck?-106:-83],[31,truck?-106:-83],[41,-63]],front?'#6c959c':'#455e62');
    c.fillStyle=front?'#e4dbac':'#c3c9ae';c.fillRect(-50,-35,100,16);
    c.fillStyle=front?'#f5e8b5':'#db7650';c.fillRect(-46,-34,19,10);c.fillRect(27,-34,19,10);
    line(c,[[-51,-16],[51,-16]],'#2f403a',5);
    if(truck){c.fillStyle='#b9b9a0';c.fillRect(-43,-147,86,61);for(let i=0;i<5;i++)line(c,[[-40,-139+i*10],[40,-139+i*10]],'#7c887d',2);}
    else line(c,[[-35,-51],[35,-51]],'#162b2b4a',2);
    line(c,[[-53,-52],[-37,-86],[34,-86]],'#ffffff77',3);
    line(c,[[-53,-12],[53,-12]],'#a7afbb',4);line(c,[[-50,-18],[50,-18]],'#181f2b',3);
    c.fillStyle='#ddd7bd';c.fillRect(-10,-21,20,8);
    if(front){for(let j=-20;j<22;j+=6)line(c,[[j,-38],[j,-25]],'#232a35',3);}
    else {line(c,[[-37,-59],[37,-59]],'#b6c7d955',2);line(c,[[-30,-80],[25,-64]],'#d1e1e544',2);}
    c.restore();
  }
  function tree(c,x,y,size,variant=0,palette=null) {
    if(size<2)return;c.save();c.translate(x,y);c.scale(size/70,size/70);
    c.fillStyle='#625845';c.fillRect(-4,-65,8,65);
    const colors=palette||['#233b2a','#3e592c','#6c8237'];
    poly(c,[[0,-139],[-18,-119],[-13,-113],[-33,-96],[-24,-89],[-43,-65],[-32,-62],[-49,-35],[-25,-25],[29,-24],[46,-43],[31,-60],[40,-70],[22,-94],[29,-98],[12,-124]],colors[0]);
    for(let j=0;j<25;j++){const yy=-127+j*3.8,ww=(yy+145)*.33,xx=Math.sin(j*5+variant)*ww;c.fillStyle=colors[j%2+1];c.fillRect(xx-7,yy,15+(j%3)*3,4);}
    c.restore();
  }
  function scenery(c,x,y,scale,kind,side) {
    if(kind==='urban_shrub'){
      c.save();c.translate(x,y);c.scale(side<0?-scale:scale,scale);
      ellipse(c,0,-1,33,3,'#3b4931');ellipse(c,-18,-5,18,5,'#435a37');ellipse(c,8,-6,25,6,'#526b3e');ellipse(c,-7,-9,15,4,'#73834c');ellipse(c,17,-9,12,3,'#839157');c.restore();
    } else if(kind==='vine'){
      c.save();c.translate(x,y);c.scale(scale,scale);line(c,[[-70,-15],[70,-15]],'#6d6844',3);for(let j=-60;j<=60;j+=24){line(c,[[j,0],[j,-30]],'#6f6d48',4);ellipse(c,j,-25,17,14,'#596c3d');ellipse(c,j-4,-29,14,11,'#72854c');}c.restore();
    } else if(kind==='rock'){
      c.save();c.translate(x,y);c.scale(scale,scale);poly(c,[[-37,0],[-32,-34],[0,-58],[29,-35],[42,0]],'#7d8279');poly(c,[[0,-58],[11,-23],[42,0],[29,-35]],'#a6a69a');c.restore();
    } else tree(c,x,y,scale*64,side);
  }
  let roadView;
  function project(z,x=0) {return roadView.project(z,x);}
  function drawWorld() {
    const t=(game.track.palette||theme[game.track.visual_theme||game.selectedTrack]),base=game.viewS,p=game.player,origin=game.track.world_origin_m||0,worldS=base+origin;
    roadView=RoadView.create(game.track,base,p.x,p.lateralV,p.v);
    const horizon=roadView.horizon,roadSamples=roadView.samples;
    asphalt.setTransform(new DOMMatrix().translate(0,(worldS*4)%96));
    const sky=ctx.createLinearGradient(0,0,0,Math.max(330,horizon));sky.addColorStop(0,t.sky[0]);sky.addColorStop(1,t.sky[1]);ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    for(let i=0;i<5;i++){
      const x=(i*293+worldS*.025)%1500-100,y=horizon-155+(i%3)*22;
      for(let j=0;j<6;j++)ellipse(ctx,x+j*14,y+Math.sin(j*2+i)*8,22+j*3,8+j%3*3,'#eef2ed55');
    }
    const offset=RR.roadAt(game.track,base).curve*18000;
    for(let layer=0;layer<3;layer++){
      const pts=[[-20,H]];for(let x=-20;x<=1300;x+=35){pts.push([x,horizon-48+layer*24+Math.sin((x+offset)/(115-layer*22)+layer*2)*(25-layer*3)+Math.sin(x/60+layer)*10]);}pts.push([1300,H]);poly(ctx,pts,[t.far,t.near,t.ground][layer]);
    }
    for(let i=roadSamples.length-2;i>=0;i--){
      const a=roadSamples[i],b=roadSamples[i+1],pa=a,pb=b,wa=a.width/2*pa.scale,wb=b.width/2*pb.scale;
      if(pa.y<=pb.y||pb.y>=a.clip||pb.y>H||a.clip<0)continue;
      ctx.save();ctx.beginPath();ctx.rect(0,0,W,Math.max(0,a.clip+1));ctx.clip();
      const band=Math.floor((worldS+a.z)/18)%2;
      ctx.fillStyle=band?t.ground:t.grass;ctx.fillRect(0,pb.y,W,Math.max(1,pa.y-pb.y+1));
      ctx.globalAlpha=.35;ctx.fillStyle=asphalt;ctx.fillRect(0,pb.y,W,Math.max(1,pa.y-pb.y+1));ctx.globalAlpha=1;
      if(game.track.visual_theme==='coast'){
        poly(ctx,[[pb.x+wb+pb.scale*12,pb.y],[W,pb.y],[W,pa.y],[pa.x+wa+pa.scale*12,pa.y]],'#668c9d');
      }
      if(a.count===2||b.count===2||a.junction||b.junction){
        for(let k=1;k<=Math.max(a.count,b.count);k++){
          let la=k===1?a.l1:a.l2,ra=k===1?(a.count===1?0:a.r1):(a.count===1?a.r1:a.r2),lb=k===1?b.l1:b.l2,rb=k===1?(b.count===1?0:b.r1):(b.count===1?b.r1:b.r2);
          if(Math.max(a.count,b.count)===1){la=a.l1;ra=a.r1;lb=b.l1;rb=b.r1;}
          if(a.junction){la=a.left-22;ra=a.right+22;}if(b.junction){lb=b.left-22;rb=b.right+22;}
          const strip=(na,fa,nb,fb,color)=>poly(ctx,[[pb.x+fa*pb.scale,pb.y-1],[pb.x+fb*pb.scale,pb.y-1],[pa.x+nb*pa.scale,pa.y+2],[pa.x+na*pa.scale,pa.y+2]],color);
          strip(la-.55,lb-.55,ra+.55,rb+.55,band?'#9c9573':'#b0a884');strip(la,lb,ra,rb,band?t.road:(t.road2||({peninsula:'#58575e',valley:'#59555e',coast:'#52545e'}[game.track.visual_theme])));
          if(!a.junction&&!b.junction){strip(la+.13,lb+.13,la+.23,lb+.23,'#d3cdb4');strip(ra-.23,rb-.23,ra-.13,rb-.13,'#d3cdb4');if(Math.floor((worldS+a.z)/7)%3!==0)strip((la+ra)/2-.05,(lb+rb)/2-.05,(la+ra)/2+.05,(lb+rb)/2+.05,'#e1ddcf');}
        }
        ctx.restore();continue;
      }
      const shoulderA=wa+pa.scale*.6,shoulderB=wb+pb.scale*.6;
      poly(ctx,[[pb.x-shoulderB,pb.y],[pb.x+shoulderB,pb.y],[pa.x+shoulderA,pa.y],[pa.x-shoulderA,pa.y]],band?'#9c9573':'#b0a884');
      const roadPoly=[[pb.x-wb,pb.y-1],[pb.x+wb,pb.y-1],[pa.x+wa,pa.y+2],[pa.x-wa,pa.y+2]];
      poly(ctx,roadPoly,band?t.road:(t.road2||({peninsula:'#58575e',valley:'#59555e',coast:'#52545e'}[game.track.visual_theme])));
      poly(ctx,roadPoly,asphalt);
      for(const x of [-.11,.11])poly(ctx,[[pb.x+(x-.04)*pb.scale,pb.y],[pb.x+(x+.04)*pb.scale,pb.y],[pa.x+(x+.04)*pa.scale,pa.y],[pa.x+(x-.04)*pa.scale,pa.y]],'#c5b45f');
      if(Math.floor((worldS+a.z)/7)%3!==0)for(const side of [-1,1])for(let lane=1;lane<a.lanes/2;lane++){
        const xa=side*a.width*lane/a.lanes,xb=side*b.width*lane/b.lanes;
        poly(ctx,[[pb.x+(xb-.045)*pb.scale,pb.y],[pb.x+(xb+.045)*pb.scale,pb.y],[pa.x+(xa+.045)*pa.scale,pa.y],[pa.x+(xa-.045)*pa.scale,pa.y]],'#e1ddcf');
      }
      for(const side of [-1,1])poly(ctx,[[pb.x+side*(wb-.13*pb.scale),pb.y],[pb.x+side*(wb-.21*pb.scale),pb.y],[pa.x+side*(wa-.21*pa.scale),pa.y],[pa.x+side*(wa-.13*pa.scale),pa.y]],'#d3cdb4');
      if(a.sidewalk)for(const side of [-1,1]){
        const x1a=pa.x+side*(wa+.15*pa.scale),x1b=pb.x+side*(wb+.15*pb.scale);
        const x2a=pa.x+side*(wa+a.sidewalk*pa.scale),x2b=pb.x+side*(wb+b.sidewalk*pb.scale);
        poly(ctx,[[x1b,pb.y],[x2b,pb.y],[x2a,pa.y],[x1a,pa.y]],'#aaa8a1');
      }
      if(game.track.visual_theme==='coast' || a.theme==='bridge')for(const side of [-1,1]){
        line(ctx,[[pb.x+side*(wb+pb.scale*.7),pb.y-pb.scale*.6],[pa.x+side*(wa+pa.scale*.7),pa.y-pa.scale*.6]],'#c7c8b7',Math.max(1,pa.scale*.08));
      }
      ctx.restore();
    }
    const draws=[];
    const first=Math.floor(worldS/32)*32-origin;
    for(let s=first;s<base+660;s+=32){
      const z=s-base+7;if(z<5)continue;
      for(const side of [-1,1]){
        const r=RR.roadAt(game.track,s),city=r.sidewalk>0,period=RR_CONFIG.environment.city_building_period_m,lot=((s+origin-(side===1?period/2:0))%period+period)%period;
        if(city)continue;
        if(game.track.visual_theme==='coast'&&side===1&&Math.floor((s+origin)/32)%3)continue;
        const x=(side<0?r.left:r.right)+side*(city?r.sidewalk+3.41+(Math.sin(s+origin)*.5+.5)*4:2.5+(Math.sin(s+origin)*.5+.5)*4),point=project(z,x);
        const kind=city?'urban_shrub':game.track.scenery_kind|| (game.selectedTrack==='valley'?'vine':game.track.visual_theme==='coast'?'rock':'tree');
        if(!r.junction&&(!city||lot>=28&&lot<=period-12&&RR.crossingDistance(game.track,s)>14))draws.push({z,clip:point.clip,draw:()=>scenery(ctx,point.x,point.y,point.scale*.06,kind,side)});
      }
    }
    const halfLot=RR_CONFIG.environment.city_building_period_m;
    for(let s=Math.floor((worldS-20)/halfLot)*halfLot-origin;s<base+720;s+=halfLot){
      const z=s-base+7,r=RR.roadAt(game.track,s),span=RoadView.buildingSpan(z);if(!span||!r.sidewalk||RR.crossingDistance(game.track,s+8)<16)continue;
      for(const side of [-1,1]){
        const index=Math.abs(Math.round((s+origin)/18)*7+(side+1)*3);
        draws.push({z,clip:project(span.near).clip,draw:()=>building(s,side,index)});
      }
    }
    const objects=[...game.traffic.filter(c=>!c.crossing||game.time>=c.departAt),...game.ai,...(game.police?[game.police]:[])];
    for(const a of objects){
      if(a.state==='recovering'&&a.recovery){
        const r=a.recovery,pose=RR.recoveryPose(r);
        for(const part of ['bike','person']){
          const z=r.bikeS+(part==='person'?pose.offset:0)-base+7;
          if(z>=3&&z<650)draws.push({z,clip:project(z).clip,draw:()=>drawRecovery(r,a.color,'sport',a.kind==='police',a.skin,part)});
        }
        continue;
      }
      const z=a.s-base+7;if(z<3||z>650)continue;const q=project(z,a.x);
      draws.push({z,clip:q.clip,draw:()=>{
        const traffic=a.kind==='car'||a.kind==='truck';
        if(game.state==='approach')ctx.globalAlpha=traffic?Math.max(0,1-game.phaseTime/1.5):RR.clamp((game.phaseTime-1.5)/1.8,0,1);
        if(traffic)ctx.globalAlpha*=RR.clamp((650-z)/100,0,1);
        if(traffic&&a.opening)ctx.globalAlpha*=RR.clamp((game.time-a.bornAt)/RR_CONFIG.traffic.opening_fade_s,0,1);
        if(a.kind==='car'||a.kind==='truck')car(ctx,q.x,q.y,q.scale*1.8,a);
        else bike(ctx,q.x,q.y,q.scale*1.05,a.color,RR.clamp((a.lateralV||0)*.13+(a.push||0)*.12+RR.roadAt(game.track,a.s).curve*40,-1.2,1.2),a.action,'sport',a.kind==='police',true,a.skin);
      }});
    }
    const gateS=['approach','countdown'].includes(game.state)||game.state==='paused'&&['approach','countdown'].includes(game.savedState)?3:game.track.length_m;
    const gateZ=gateS-base+7;
    if(game.state!=='title'&&gateZ>3&&gateZ<650){const q=project(gateZ),rw=RR.roadAt(game.track,gateS).width/2*q.scale;draws.push({z:gateZ,clip:q.clip,draw:()=>{if(game.state==='approach')ctx.globalAlpha=RR.clamp(game.phaseTime/1.8,0,1);drawGate(q,rw);}});}
    draws.sort((a,b)=>b.z-a.z).forEach(d=>{if(d.clip<=0)return;ctx.save();ctx.beginPath();ctx.rect(0,0,W,Math.max(0,d.clip));ctx.clip();d.draw();ctx.restore();});
    drawPlayer();
    drawImpact();
    for(const hit of game.crashEffects){
      const z=hit.s+hit.speed/3.6*Math.min(hit.age,.7)*.5-base+7;if(z<3||z>160)continue;
      const q=project(z,hit.x),scale=Math.min(1.6,q.scale/65),fade=Math.max(0,1-hit.age/1.4);
      ctx.save();ctx.globalAlpha=fade;
      for(let i=0;i<16;i++){
        const a=i*2.4,spread=15+hit.age*95;
        ellipse(ctx,q.x+Math.cos(a)*spread*scale,q.y-25*scale+Math.sin(a)*spread*.4*scale,scale*(3+hit.age*13),scale*(2+hit.age*5),i%3?'#d7bf8a88':'#ffe5a6');
      }ctx.restore();
    }
    if(p.v>105&&game.state==='racing'){
      ctx.globalAlpha=(p.v-105)/250;
      for(let i=0;i<8;i++){const yy=430+(i*49+game.time*230)%280,side=i%2?1:-1;line(ctx,[[640+side*(350+(yy-430)*.7),yy],[640+side*(370+(yy-430)*.7),yy+12]],'#edf0e1',2);}
      ctx.globalAlpha=1;
    }
    if(game.screenFlash>0){ctx.fillStyle=`rgba(255,231,177,${game.screenFlash*.25})`;ctx.fillRect(0,0,W,H);}
    if(game.state==='arresting'){ctx.fillStyle=`rgba(15,30,27,${Math.min(.4,game.phaseTime*.4)})`;ctx.fillRect(0,0,W,H);}
    // Subtle edge vignette leaves the road and vehicles unobstructed.
    const vignette=ctx.createRadialGradient(640,370,280,640,370,800);vignette.addColorStop(0,'#0e272400');vignette.addColorStop(1,'#0e272449');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  }
  function drawImpact(){
    const hit=game.impact;if(!hit)return;const t=hit.age,fade=Math.max(0,1-t/.4),q=project(hit.s-game.viewS+7,hit.x);
    if(q.z<3||q.z>80)return;const scale=Math.min(1.4,q.scale/70);
    ctx.save();ctx.translate(q.x,q.y-(hit.kind==='hand'?110:70)*scale);ctx.scale(scale,scale);ctx.globalAlpha=fade;
    for(let i=0;i<9;i++){const a=i*2.4,rr=10+t*170;line(ctx,[[Math.cos(a)*rr,Math.sin(a)*rr*.7],[Math.cos(a)*(rr+15),Math.sin(a)*(rr+15)*.7]],i%2?'#ffe8a3':'#f89e49',3);}
    if(t<.11){poly(ctx,[[-22,0],[-6,-6],[0,-23],[5,-5],[25,0],[6,6],[0,24],[-5,5]],'#fff6c4');}
    ctx.restore();
  }
  function drawRecovery(r,color,style,chaser=false,skin=null,part='both'){
    if(!r)return;const pose=RR.recoveryPose(r),z=r.bikeS-game.viewS+7,b=project(z,r.bikeX),scale=Math.min(1.15,b.scale/78),t=r.age;
    if(z>=3&&part!=='person'){
      const lift=pose.phase==='mount'?pose.mountProgress:0;
      ctx.save();ctx.translate(b.x,b.y-8);ctx.rotate(-r.side*Math.min(1.45,t*4)*(1-lift));bike(ctx,0,0,scale*102,color,0,null,style,chaser,false);ctx.restore();
    }
    if(part==='bike'||z+pose.offset<3)return;
    // Ground shadow remains on the road while the body follows a separate airborne arc.
    const person=project(z+pose.offset,pose.x??r.bikeX+r.side*.6),s=Math.min(1.1,person.scale/70);
    ellipse(ctx,person.x,person.y,28*s*(1+pose.height*.1),7*s,'#15172288');
    if(z>=3&&t<r.flight+1){
      for(let j=0;j<12;j++){const life=RR.clamp((t-j*.025)/(r.flight+.6),0,1);if(life===0)continue;ellipse(ctx,b.x+r.side*j*6*scale,b.y-j*2*scale,Math.max(1,life*16*scale),Math.max(1,life*5*scale),`rgba(187,174,140,${(1-life)*.5})`);}
      line(ctx,[[b.x,b.y],[b.x+r.side*30*scale,b.y-5*scale]],'#25283199',5*scale);
    }
    ctx.save();ctx.translate(person.x,person.y-pose.height*person.scale);ctx.scale(s,s);
    const falling=['air','slide','stand'].includes(pose.phase),walk=pose.phase==='run'&&pose.walking!==false?Math.sin(t*19)*19:0,mount=pose.phase==='mount'?pose.mountProgress:0;
    if(falling){ctx.translate(0,-35);ctx.rotate(r.side*pose.rotation);ctx.translate(0,35);}
    const suit=skin?.suit||(chaser?'#c67b2e':'#ab2d31'),pants=skin?.pants||'#293e67';
    const hip=-45-mount*39,knee=-20-mount*42,foot=-3-mount*27,shoulder=-83-mount*31,head=-103-mount*33,swing=Math.sin(mount*Math.PI)*26;
    line(ctx,[[-8,hip],[-12+walk-swing,knee],[-15+walk-swing,foot]],pants,12);line(ctx,[[8,hip],[12-walk+swing,knee],[15-walk+swing,foot]],pants,12);
    line(ctx,[[-15+walk-swing,foot],[-23+walk-swing,foot+3]],'#151923',8);line(ctx,[[15-walk+swing,foot],[22-walk+swing,foot+3]],'#151923',8);
    poly(ctx,[[-17,hip+1],[-21,shoulder],[-13,shoulder-8],[14,shoulder-8],[22,shoulder+1],[17,hip+1]],suit);
    line(ctx,[[-15,shoulder+2],[0,shoulder-1],[16,shoulder+2]],skin?.trim||'#ee9d76',4);
    if(skin?.pattern===1)line(ctx,[[-12,shoulder+3],[12,hip-3]],skin.trim,7);
    line(ctx,[[-18,shoulder+2],[-28-walk*.6,falling?-95:-53-mount*32]],suit,10);line(ctx,[[18,shoulder+2],[28+walk*.6,falling?-105:-53-mount*32]],suit,10);
    ellipse(ctx,0,head,11,13,skin?.helmet||(chaser?'#eab848':'#d6d7da'));line(ctx,[[-10,head+1],[10,head+1]],'#333b4f',4);ctx.restore();
  }
  function drawGate(q,width){
    const top=q.y-q.scale*4.8;
    line(ctx,[[q.x-width-5,q.y],[q.x-width-5,top],[q.x+width+5,top],[q.x+width+5,q.y]],'#ded8bc',Math.max(2,q.scale*.09));
    const height=q.scale*.6,left=q.x-width;
    ctx.fillStyle='#eee6c6';ctx.fillRect(left,top,width*2,height);
    const unit=width*2/16;
    for(let row=0;row<2;row++)for(let col=0;col<16;col++)if((row+col)%2){ctx.fillStyle='#243b35';ctx.fillRect(left+col*unit,top+row*height/2,unit,height/2);}
  }
  function drawPlayer(){
    const p=game.player,point=project(7,p.x),size=102;
    const r=game.recovery;
    if(r&&['recovering','paused','arresting','finishing','result'].includes(game.state)){
      drawRecovery(r,game.bike.color,game.bike.style);
    }else{
      const bob=game.state==='racing'?Math.sin(game.time*28)*Math.min(1,p.v/70)+(game.input.brake?3:-p.v/150):Math.sin(game.phaseTime*4)*.6;
      if(p.grace>0&&Math.floor(p.grace*10)%2===0)ctx.globalAlpha=.6;
      bike(ctx,point.x,point.y+bob,size,game.bike.color,p.lean+p.push*.12,p.action,game.bike.style);ctx.globalAlpha=1;
    }
  }
  function formatTime(time){const n=Math.floor(time);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function syncUI(){
    const state=game.state,active=['racing','recovering','paused','arresting','finishing','countdown','approach'].includes(state);
    $('home').hidden=state!=='title'&&!(state==='approach'&&game.phaseTime<1.6);
    $('home').classList.toggle('departing',state!=='title');$('home').inert=state!=='title';
    $('hud').hidden=!active||state==='approach';$('pauseButton').hidden=!['racing','recovering','approach','countdown'].includes(state);
    $('touchControls').hidden=inputMode!=='touch'||!['racing','recovering'].includes(state);
    $('pausePanel').hidden=state!=='paused'||!$('abandonPanel').hidden;
    const mayRetire=game.tour?.results.length>0;
    $('abandon').textContent=mayRetire?'退赛结算':'返回首页';
    $('abandonPanel').querySelector('h2').textContent=mayRetire?'退赛？已取得结算资格':'放弃本局？';
    $('confirmAbandon').textContent=mayRetire?'退赛':'返回首页';
    $('resultPanel').hidden=state!=='result';
    $('rank').innerHTML=`${game.rank()}<span>/15</span>`;
    $('stamina').style.height=`${(game.player.stamina??100)/RR_CONFIG.stamina.capacity*100}%`;$('speed').textContent=Math.round(game.player.v);$('distance').textContent=`${(game.player.s/1000).toFixed(1)} / ${(game.track.length_m/1000).toFixed(1)}`;
    $('loadout').textContent=(game.tour?`第 ${game.tour.round} / 3 站　`:'')+(game.player.weapon?RR_CONFIG.weapons[game.player.weapon].name:'');$('clock').textContent=formatTime(game.time);$('speedNeedle').setAttribute('transform',`rotate(${-120+RR.clamp(game.player.v/180,0,1)*240} 90 90)`);
    $('progress').style.width=`${RR.clamp(game.player.s/game.track.length_m*100,0,100)}%`;
    $('pursuit').hidden=!game.police||Math.abs(game.police.s-game.player.s)>160||!active;
    $('pursuit').style.opacity=game.police?.targetId==='player'?'1':'.55';
    $('capture').style.width=`${RR.clamp(game.capture/(game.state==='recovering'?.6:2),0,1)*100}%`;
    $('countdown').hidden=state!=='countdown';if(state==='countdown')$('countdown').textContent=Math.max(1,3-Math.floor(game.phaseTime));
    if(state!==lastState){
      releaseAll();
      if(state==='result'){
        const r=game.result;$('resultTitle').textContent=r.reason==='finish'?'冲线完成':'被拦停';$('resultSymbol').textContent=r.reason==='finish'?'⚑':'◇';
        $('resultRank').textContent=r.rank;$('resultRankLabel').textContent=r.reason==='finish'?'名次':'拦停前名次';$('resultTime').textContent=formatTime(r.time);$('resultDistance').textContent=(r.distance/1000).toFixed(1);showTourResult();
      }
      lastState=state;
    }
    for(const e of game.events.slice(lastEvent)){
      if(e.type==='crash'||['rider_crash','pursuer_crash'].includes(e.type)&&Math.abs(e.s-game.player.s)<35)tone(75,.25,'sawtooth',.10);
      else if(e.type==='hit')tone(180,.07,'triangle',.08);
      else if(e.type==='started')tone(660,.25,'square',.025);
      else if(e.type==='ended'){tone(e.reason==='finish'?660:180,.5,'triangle',.07);}
    }
    lastEvent=game.events.length;
    if(engineOsc&&audio){engineOsc.frequency.setTargetAtTime(35+game.player.v*.85,audio.currentTime,.1);engineGain.gain.setTargetAtTime(soundOn&&['racing','recovering','approach','title'].includes(state)?.012:0,audio.currentTime,.1);}
  }
  function tone(freq,duration,type='triangle',volume=.04){if(!audio||!soundOn)return;const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}
  async function toggleAudio(){
    if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();engineOsc=audio.createOscillator();engineGain=audio.createGain();engineOsc.type='sawtooth';engineGain.gain.value=0;engineOsc.connect(engineGain).connect(audio.destination);engineOsc.start();}
    await audio.resume();soundOn=!soundOn;$('audioButton').setAttribute('aria-pressed',String(soundOn));$('audioButton').setAttribute('aria-label',soundOn?'关闭声音':'开启声音');
    $('audioButton').innerHTML=`<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z${soundOn?'M17 8q5 4 0 8':'M17 9l4 6m0-6-4 6'}"/></svg>`;
  }
  function releaseAll(){held.clear();game.clearInput();document.querySelectorAll('.held').forEach(b=>b.classList.remove('held'));}
  function refreshHeld(){for(const key of ['left','right','forward','backward','brake','hand','foot'])game.input[key]=[...held.values()].some(v=>v.actions.includes(key));document.querySelectorAll('[data-hold]').forEach(b=>b.classList.toggle('held',game.input[b.dataset.hold]));}
  document.querySelectorAll('[data-hold]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{if(game.state!=='racing')return;e.preventDefault();button.setPointerCapture(e.pointerId);held.set(e.pointerId,{actions:[button.dataset.hold],button});refreshHeld();if(['hand','foot'].includes(button.dataset.hold))game.interact(button.dataset.hold);});
    const release=e=>{held.delete(e.pointerId);refreshHeld();};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('pointermove',e=>{if(!held.has(e.pointerId))return;const r=button.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)release(e);});
  });
  const pad=$('directionPad');
  function movePad(e){
    const r=pad.getBoundingClientRect(),x=RR.clamp((e.clientX-r.left)/r.width*2-1,-1,1),y=RR.clamp((e.clientY-r.top)/r.height*2-1,-1,1);
    held.set(e.pointerId,{actions:[...(x<-.22?['left']:x>.22?['right']:[]),...(y>.35?['brake','backward']:y<-.35?['forward']:[])],pad:true});
    $('padThumb').style.left=`${50+x*32}%`;$('padThumb').style.top=`${50+y*32}%`;pad.classList.add('held');refreshHeld();
  }
  pad.addEventListener('pointerdown',e=>{if(!['racing','recovering'].includes(game.state)||[...held.values()].some(v=>v.pad))return;e.preventDefault();pad.setPointerCapture(e.pointerId);movePad(e);});
  pad.addEventListener('pointermove',e=>{if(held.get(e.pointerId)?.pad)movePad(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(type,e=>{if(!held.get(e.pointerId)?.pad)return;held.delete(e.pointerId);pad.classList.remove('held');refreshHeld();});
  const keyActions={ArrowLeft:['left'],KeyA:['left'],ArrowRight:['right'],KeyD:['right'],ArrowUp:['forward'],KeyW:['forward'],ArrowDown:['brake','backward'],KeyS:['brake','backward'],Space:['brake'],KeyJ:['hand'],KeyK:['foot']};
  window.addEventListener('keydown',e=>{
    if(!$('modal').hidden){if(e.code==='Escape')closeModal();return;}
    if(keyActions[e.code]){e.preventDefault();if(['racing','recovering'].includes(game.state)){held.set(e.code,{actions:keyActions[e.code]});refreshHeld();}}
    if(e.repeat)return;
    if(e.code==='KeyJ')game.interact('hand');if(e.code==='KeyK')game.interact('foot');
    if(e.code==='Escape'){e.preventDefault();if(game.state==='paused'){ $('abandonPanel').hidden=true;game.resume();}else game.pause();}
    if(e.code==='Enter'&&game.state==='title')start();
  });
  window.addEventListener('keyup',e=>{held.delete(e.code);refreshHeld();});
  function pollGamepad(){
    const pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&p.mapping==='standard');
    const nextMode=pad?'gamepad':mobileDevice?'touch':'desktop';
    if(inputMode!==nextMode){releaseAll();inputMode=nextMode;$('stage').dataset.input=inputMode;}
    if(!pad){gamepadButtons=[];return;}
    const down=pad.buttons.map(b=>b.pressed||b.value>.5),pressed=i=>down[i]&&!gamepadButtons[i];
    if(pressed(9)){if(game.state==='paused')game.resume();else game.pause();}
    if(['racing','recovering'].includes(game.state)&&$('modal').hidden){
      held.set('gamepad',{actions:[...(pad.axes[0]<-.2||down[14]?['left']:[]),...(pad.axes[0]>.2||down[15]?['right']:[]),...(pad.axes[1]>.5||down[13]?['backward']:[]),...(pad.axes[1]<-.5||down[12]?['forward']:[]),...(pad.axes[1]>.5||down[13]||down[6]?['brake']:[]),...(down[2]?['hand']:[]),...(down[0]?['foot']:[])]});refreshHeld();
      if(pressed(0))game.interact('foot');else if(pressed(2))game.interact('hand');
    }else{
      held.delete('gamepad');refreshHeld();
      const scope=!$('modal').hidden?$('modal'):game.state==='title'?$('home'):game.state==='result'?$('resultPanel'):game.state==='paused'?(!$('abandonPanel').hidden?$('abandonPanel'):$('pausePanel')):null;
      if(scope){
        const buttons=[...scope.querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled),index=buttons.indexOf(document.activeElement);
        if(pressed(12)||pressed(14))buttons[(index-1+buttons.length)%buttons.length]?.focus();
        if(pressed(13)||pressed(15))buttons[(index+1)%buttons.length]?.focus();
        if(pressed(0))(buttons.includes(document.activeElement)?document.activeElement:buttons[0])?.click();
        if(pressed(1)&&!$('modal').hidden)closeModal();
      }
    }
    gamepadButtons=down;
  }
  window.addEventListener('gamepaddisconnected',()=>{releaseAll();gamepadButtons=[];game.pause();});
  window.addEventListener('blur',()=>{releaseAll();game.pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseAll();game.pause();}});
  function start(){lastEvent=0;game.start();syncUI();}
  $('start').onclick=start;$('tourStart').onclick=()=>{lastEvent=0;game.beginTour();syncUI();};$('restart').onclick=()=>{if(!game.tour){start();return;}lastEvent=0;game.tour.completed?game.beginTour():game.nextTourStage();syncUI();};$('pauseButton').onclick=()=>game.pause();$('resume').onclick=()=>game.resume();
  $('abandon').onclick=()=>{$('abandonPanel').hidden=false;$('pausePanel').hidden=true;};
  $('cancelAbandon').onclick=()=>{$('abandonPanel').hidden=true;};
  $('confirmAbandon').onclick=()=>{$('abandonPanel').hidden=true;lastEvent=0;if(game.tour)game.withdrawTour();else game.abandon();};
  $('backHome').onclick=()=>{lastEvent=0;if(game.tour)game.withdrawTour();else game.toTitle();};$('audioButton').onclick=()=>toggleAudio().catch(showError);$('retry').onclick=()=>location.reload();
  function closeModal(){$('modal').hidden=true;modalFocus?.focus();}
  $('closeModal').onclick=closeModal;$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});
  function openModal(title,html,source){if(game.state!=='title')return;modalFocus=source;$('modalTitle').textContent=title;$('modalContent').innerHTML=html;$('modal').hidden=false;$('closeModal').focus();}
  $('modal').addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;const list=[...$('modal').querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled);const first=list[0],end=list.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}
  });
  function showSelector(kind,page=0){
    const tracks=kind==='track',weapons=kind==='weapon',data=tracks?RR_CONFIG.tracks:weapons?RR_CONFIG.free_weapon_choices:RR_CONFIG.bikes,pages=Math.ceil(data.length/3);page=RR.clamp(page,0,pages-1);
    const descriptions={peninsula:'城市穿行',valley:'起伏田野',coast:'长弯海岸',harbor:'蓝海缓坡',mesa:'赤岩连弯',orchard:'金秋公路',highland:'高原山弯',comet:'均衡易上手',falcon:'极速优先',trail:'灵活耐越野',comet_gt:'均衡进阶',falcon_rr:'高速更稳',trail_xr:'越野更灵活'};
    openModal(tracks?'选择赛道':'车库',`${tracks?'':`<div class="garage-tabs"><button id="selectBikes" aria-pressed="${!weapons}">选摩托</button><button id="selectWeapons" aria-pressed="${weapons}">选武器</button></div>`}<div class="selection-grid">${data.slice(page*3,page*3+3).map(item=>`<button class="selection-card ${item.id===(tracks?game.selectedTrack:weapons?game.selectedWeapon:game.selectedBike)?'selected':''}" data-choice="${item.id}"><canvas width="360" height="220" data-preview="${item.id}"></canvas><strong>${item.name}</strong><small>${weapons?item.brief:(tracks?item.length_m/1000+' km':item.max_speed_kmh+' km/h')+' · '+descriptions[item.id]}</small></button>`).join('')}</div>${weapons?'<p class="free-equipment">自由赛</p>':`<div class="catalog-pages"><button id="catalogPrevious" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${pages}</span><button id="catalogNext" ${page===pages-1?'disabled':''}>下一页</button></div>`}`,tracks?$('tracksButton'):$('garageButton'));
    for(const b of document.querySelectorAll('[data-choice]')){b.dataset[tracks?'track':weapons?'weapon':'bike']=b.dataset.choice;b.onclick=()=>{tracks?game.selectTrack(b.dataset.choice):weapons?game.selectWeapon(b.dataset.choice):game.selectBike(b.dataset.choice);lastEvent=0;closeModal();};}
    if(!weapons){$('catalogPrevious').onclick=()=>showSelector(kind,page-1);$('catalogNext').onclick=()=>showSelector(kind,page+1);}if(!tracks){$('selectBikes').onclick=()=>showSelector('bike');$('selectWeapons').onclick=()=>showSelector('weapon');}
    for(const c of document.querySelectorAll('[data-preview]')){
      const item=data.find(v=>v.id===c.dataset.preview),g=c.getContext('2d');
      if(weapons){g.translate(40,8);g.scale(1.4,1.4);menuDrawing(g,item.id);}
      else if(tracks){const t=item.palette||theme[item.visual_theme||item.id];g.fillStyle=t.sky[0];g.fillRect(0,0,360,220);poly(g,[[0,100],[80,55],[170,100],[240,70],[360,100],[360,220],[0,220]],t.near);g.fillStyle=t.ground;g.fillRect(0,120,360,100);poly(g,[[170,120],[190,120],[300,220],[50,220]],t.road);line(g,[[180,125],[175,160],[170,220]],'#dfc88b',3);if(item.visual_theme==='coast')poly(g,[[280,115],[360,100],[360,220],[320,220]],'#719aa8');else for(let i=0;i<4;i++)tree(g,25+i*33,170+i*9,30+i*7);}
      else{g.fillStyle='#233d34';g.fillRect(0,0,360,220);for(let i=0;i<4;i++)line(g,[[0,100+i*35],[360,100+i*35]],'#d1cf9e0d',1);bike(g,180,190,100,item.color,-.25,null,item.style,false,false);}
    }
  }
  $('tracksButton').onclick=()=>showSelector('track');$('garageButton').onclick=()=>showSelector('bike');
  // Original chunky garage illustrations; shared with the native command baker.
  function menuDrawing(g,id){
    const shape=(p,c)=>poly(g,p,c),oval=(x,y,rx,ry,c)=>{g.fillStyle=c;g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fill();};
    const ink='#141923',steel='#bcc6c2',shade='#627f83',paper='#ecd8a7',red='#c34b30';
    oval(100,128,88,9,'#11151b');
    if(id==='none'){
      shape([[54,119],[49,88],[35,77],[40,60],[55,61],[55,34],[70,31],[77,37],[84,26],[100,27],[108,36],[121,33],[135,40],[142,59],[152,66],[148,93],[130,118]],ink);
      shape([[62,110],[58,82],[45,73],[47,69],[64,72],[64,40],[70,39],[77,46],[87,36],[98,36],[105,46],[121,42],[128,47],[133,66],[143,73],[139,91],[124,110]],paper);
      g.fillStyle=shade;g.fillRect(77,48,5,28);g.fillRect(102,48,5,26);g.fillRect(126,57,5,24);g.fillStyle=red;g.fillRect(61,102,65,12);
    }else if(id==='handling'){
      shape([[31,124],[18,110],[111,36],[117,12],[146,4],[134,25],[143,39],[164,32],[156,59],[133,66]],ink);
      shape([[32,113],[28,109],[119,40],[123,18],[137,13],[128,29],[141,48],[155,40],[149,53],[129,57]],steel);
      shape([[43,109],[35,107],[117,45],[122,50]],shade);oval(34,108,5,5,ink);
      shape([[92,99],[91,84],[114,70],[127,82],[123,105],[105,116]],ink);shape([[99,97],[98,87],[113,79],[120,86],[117,101],[106,108]],red);
    }else if(id==='power'){
      shape([[34,119],[27,67],[52,51],[61,23],[143,23],[157,47],[174,65],[165,119]],ink);
      shape([[40,112],[35,72],[58,58],[65,32],[137,32],[146,55],[164,70],[157,111]],shade);
      shape([[62,54],[66,29],[138,29],[148,54]],steel);shape([[77,36],[126,36],[135,47],[72,47]],paper);
      for(let i=0;i<4;i++)g.fillStyle=ink,g.fillRect(55,62+i*10,97,4);
      oval(91,105,24,20,ink);oval(91,104,17,13,red);oval(91,104,6,5,paper);
      shape([[147,91],[178,91],[182,103],[159,110]],steel);
    }else if(id==='upgrade'){
      for(const x of [37,164]){oval(x,101,28,29,ink);oval(x,101,18,18,steel);oval(x,101,9,9,shade);}
      shape([[35,101],[70,59],[128,59],[163,101],[91,107]],ink);shape([[48,94],[73,69],[110,72],[89,94]],shade);
      shape([[89,54],[100,31],[144,33],[152,57],[125,74],[83,70]],ink);shape([[96,53],[106,39],[139,40],[143,53],[123,65],[91,64]],red);
      shape([[40,52],[81,52],[95,65],[58,65]],ink);shape([[43,52],[77,50],[84,56],[49,57]],paper);
      shape([[143,36],[149,22],[173,24],[174,32],[158,31],[154,51],[171,98],[162,102]],steel);
      shape([[77,100],[129,105],[136,113],[69,112]],steel);shape([[86,76],[108,76],[113,94],[82,97]],paper);
    }else if(id==='bat'){
      shape([[36,119],[27,108],[123,7],[146,8],[155,28],[52,124]],ink);
      shape([[39,111],[36,108],[128,15],[141,16],[146,28],[48,115]],'#bd8145');
      shape([[66,89],[55,99],[60,105],[72,94]],paper);shape([[55,100],[44,110],[49,116],[61,105]],steel);
      shape([[82,77],[132,24],[137,25],[87,80]],'#efd09a');
    }else{
      for(let i=0;i<5;i++){const x=42+i*27,y=104-i*16;g.save();g.translate(x,y);g.rotate(-.55);oval(0,0,26,17,ink);oval(0,-2,21,12,steel);oval(0,-2,12,5,ink);g.restore();}
      shape([[150,25],[164,12],[180,18],[175,34],[162,43]],ink);shape([[159,27],[167,20],[173,23],[168,33]],paper);
    }
  }
  function menuLettering(g,word){
    const glyph={
      '车':[[1,2,10,2],[5,0,2,6],[2,6,10,6],[1,9,10,9],[6,4,6,12]],
      '库':[[5,0,6,1],[2,2,10,2],[2,2,1,12],[4,4,10,4],[7,3,4,7],[4,7,10,7],[3,10,10,10],[7,5,7,12]],
      '自':[[5,0,4,2],[2,2,2,12],[2,2,10,2],[10,2,10,12],[2,12,10,12],[2,5.3,10,5.3],[2,8.6,10,8.6]],
      '由':[[2,4,2,12],[2,4,10,4],[10,4,10,12],[2,12,10,12],[2,8,10,8],[6,0,6,12]],
      '锦':[[2,0,0,3],[1,3,3,3],[0,5,3,5],[0,7,3,7],[1.5,5,1.5,12],[1.5,12,3.5,10],[7,0,6,2],[4.5,2,4.5,6],[4.5,2,10,2],[10,2,10,6],[4.5,6,10,6],[4.5,4,10,4],[4.5,8,4.5,12],[4.5,8,10,8],[10,8,10,12],[7.2,6,7.2,12]],
      '标':[[0,4,4,4],[2,0,2,12],[2,4,0,10],[2,5,4,8],[5,1,10,1],[4.5,4,11,4],[7.7,4,7.7,12],[5.5,7,4.5,11],[9.5,7,11,11]],
      '赛':[[5.5,0,6,1],[1,2,1,3.5],[1,2,11,2],[11,2,10.5,3.5],[2,4,10,4],[2,6,10,6],[4,3,4,7],[8,3,8,7],[1,7.5,11,7.5],[4,7,1,10],[8,7,11,10],[4,9,4,12],[4,9,8,9],[8,9,8,12],[6,10,6,12],[5.5,12,3,13],[6.5,12,9,13]],
      '出':[[6,0,6,12],[2,1,2,6],[2,6,10,6],[10,1,10,6],[1,8,1,12],[1,12,11,12],[11,8,11,12]],
      '发':[[4,0,1,3],[1,3,10,3],[9,0,10,1],[6,1,4.5,7],[4.5,7,1,12],[4,6,10,6],[10,6,8,9],[8,9,4,12],[5,7,7.5,10],[7.5,10,11,12]],
      '退':[[1,4,2,5],[0,7,2,7],[2,7,2,10],[1,10,4,12],[4,12,11,12],[4,0,4,9.5],[4,0,10,0],[10,0,10,5],[4,2.5,10,2.5],[4,5,10,5],[4,9.5,6,8.5],[10,6,8,7.5],[6,5.5,7.5,8],[7.5,8,10.5,10]]
    };
    g.fillStyle='#ffe9ab';let offset=0;
    for(const c of word){const thickness='锦赛退'.includes(c)?1.25:1.7;for(const [x1,y1,x2,y2]of glyph[c]){const ax=offset+x1+(12-y1)*.13,bx=offset+x2+(12-y2)*.13,dx=bx-ax,dy=y2-y1;g.save();g.translate((ax+bx)/2+1,(y1+y2)/2+1);g.rotate(Math.atan2(dy,dx));g.fillRect(-Math.hypot(dx,dy)/2-.45,-thickness/2,Math.hypot(dx,dy)+.9,thickness);g.restore();}offset+=14;}
  }

  // Menu artwork ends here; the builder captures the same original strokes.
  function paintLettering(canvas,word){canvas.width=word.length*56;canvas.height=60;const g=canvas.getContext('2d');g.scale(4,4);menuLettering(g,word);}
  function setMenuLabel(button,word){button.setAttribute('aria-label',word);button.innerHTML='<canvas class="menu-lettering" aria-hidden="true"></canvas>';paintLettering(button.firstChild,word);}
  setMenuLabel($('start'),'自由赛');setMenuLabel($('tourStart'),'锦标赛');
  function showTourResult(){
    const t=game.tour,panel=$('tourResult');panel.hidden=!t;if(!t){$('restart').removeAttribute('aria-label');$('backHome').removeAttribute('aria-label');$('restart').textContent='再玩一次';$('backHome').textContent='返回首页';document.querySelector('.result-complete').textContent='本局已完成';return;}
    const board=game.getTourStandings(),place=board.findIndex(v=>v.id==='player')+1,selected=RR_CONFIG.bikes.find(b=>b.id===game.selectedBike);
    const state=id=>t.upgrades[id]||id==='upgrade'&&selected.tier===2||t.weapon===id?'已装':t.wallet<RR_CONFIG.championship.prices[id]?'不足':'买';
    $('resultTitle').innerHTML=t.completed?(place===1?'锦标赛冠军':'锦标赛'):'<canvas class="garage-head menu-lettering" aria-label="车库"></canvas><span>'+t.round+' / 3</span>';
    document.querySelector('.result-complete').textContent=game.result.reason==='finish'?game.result.rank+' / 15':'被拦停';
    panel.innerHTML=`<div class="garage-top"><div class="wallet"><small>赏金</small><strong>${t.wallet}</strong></div></div><p class="tour-owned">${selected.name} ／ ${t.weapon?RR_CONFIG.weapons[t.weapon].name:'徒手'}</p>${!t.completed?`<div class="tour-shop">${RR_CONFIG.championship.offers.map(({id,name,short_name})=>`<button data-buy="${id}" data-status="${state(id)}" ${state(id)!=='买'?'disabled':''}><canvas width="400" height="280" aria-hidden="true"></canvas><strong>${short_name||name}</strong><b>${state(id)==='买'?'买 · '+RR_CONFIG.championship.prices[id]:state(id)}</b></button>`).join('')}</div>`:`<p class="tour-board">${board.slice(0,3).map((r,i)=>`${i+1}. ${r.id==='player'?'你':r.id.replace('rider_','车手 ')}　${r.points} 分`).join('<br>')}<br>你的总排名：${place} / 15</p>`}`;
    setMenuLabel($('backHome'),'退出');setMenuLabel($('restart'),'出发');
    if(!t.completed){paintLettering(document.querySelector('.garage-head'),'车库');for(const b of panel.querySelectorAll('[data-buy]')){const g=b.querySelector('canvas').getContext('2d');g.scale(2,2);menuDrawing(g,b.dataset.buy);b.onclick=()=>{if(game.buyTour(b.dataset.buy))showTourResult();};}}
  }

  const stamina=RR_CONFIG.stamina,interaction=RR_CONFIG.interaction;
  const helpValues={pause_key:'Esc',pad_pause_key:'Options',hand_damage:stamina.hand_damage,foot_damage:stamina.foot_damage,bat_damage:stamina.bat_damage,capacity:stamina.capacity,police_capacity:stamina.police_capacity,hand_recovery:interaction.hand_recovery_s,foot_recovery:interaction.foot_recovery_s,hand_hits:Math.ceil(stamina.capacity/stamina.hand_damage),foot_hits:Math.ceil(stamina.capacity/stamina.foot_damage),police_hand_hits:Math.ceil(stamina.police_capacity/stamina.hand_damage),police_foot_hits:Math.ceil(stamina.police_capacity/stamina.foot_damage),capture_hold:RR_CONFIG.police.capture_hold_s,capture_foot_hold:RR_CONFIG.police.capture_recovering_hold_s};
  function helpText(value){return value.replace(/\{(\w+)\}/g,(_,key)=>{if(!(key in helpValues))throw Error('RR_HELP_VALUE '+key);return helpValues[key];});}
  function showHelpPage(index){
    index=Math.max(0,Math.min(RR_CONFIG.instructions.length-1,index));const page=RR_CONFIG.instructions[index];
    $('modalTitle').textContent=`操作说明　${index+1} / ${RR_CONFIG.instructions.length}　${page.title}`;
    const sketches=['<rect x="10" y="6" width="26" height="26"/><rect x="44" y="6" width="26" height="26"/><rect x="10" y="40" width="26" height="26"/><rect x="44" y="40" width="26" height="26"/><path d="m22 12-7 14h14m22-14v14h7q9-7 0-14z"/>','<circle cx="30" cy="36" r="23"/><path d="M15 36h30M30 21v30"/><circle cx="70" cy="18" r="10"/><circle cx="82" cy="53" r="13"/>','<path d="M18 20Q5 12 4 40t16 8l10-6h22l12 7q20 15 16-15T64 20zM16 27v19M7 36h18"/><circle cx="59" cy="28" r="4"/><circle cx="69" cy="40" r="4"/>'];
    const sections=(values,primary=false)=>values.map((section,col)=>`<section><h3>${section.title}</h3>${section.rows.map((row,i)=>`<p class="${primary&&index===0&&i===0?'key-focus':''}">${helpText(row)}</p>`).join('')}${primary&&index===0?`<svg class="input-sketch" viewBox="0 0 96 72" aria-hidden="true">${sketches[col]}</svg>`:''}</section>`).join('');
    $('modalContent').innerHTML=`<div class="help-content"><div class="help-columns help-controls">${sections(page.columns,true)}</div><div class="help-columns help-secondary">${sections(page.rules)}</div><div class="help-pagination"><button id="helpPrevious" ${index===0?'disabled':''}>上一页</button><span>${index===0?'自动加速 · 先学转向和刹车':index+1+' / '+RR_CONFIG.instructions.length}</span><button id="helpNext" ${index===RR_CONFIG.instructions.length-1?'disabled':''}>下一页</button></div></div>`;
    $('modalContent').scrollTop=0;
    for(const [id,step]of [['helpPrevious',-1],['helpNext',1]])$(id).onclick=()=>{showHelpPage(index+step);const next=$(id);(next.disabled?$(step>0?'helpPrevious':'helpNext'):next).focus({preventScroll:true});};
  }
  $('helpButton').onclick=function(){openModal('操作说明','',this);showHelpPage(0);};
  function showError(error){console.error(error);$('errorMessage').textContent=String(error.message||error);$('errorPanel').hidden=false;game.pause();}
  function frame(now){
    try{const started=performance.now(),dt=(now-last)/1000;last=now;pollGamepad();game.update(dt);
      const {x:sx,y:sy}=game.cameraOffset();
      ctx.setTransform(.5,0,0,.5,0,0);ctx.fillStyle='#202631';ctx.fillRect(0,0,W,H);ctx.translate(sx,sy);drawWorld();syncUI();tickSamples.push(dt*1000);workSamples.push(performance.now()-started);if(tickSamples.length>600)tickSamples.shift();if(workSamples.length>600)workSamples.shift();}
    catch(error){showError(error);return;}
    requestAnimationFrame(frame);
  }
  // Read-only diagnostics. No scenario injection or instant finish controls in the UI.
  Object.defineProperty(window,'roadRash',{value:Object.freeze({snapshot:()=>JSON.parse(JSON.stringify({state:game.state,track:game.selectedTrack,bike:game.selectedBike,time:game.time,player:game.player,rank:game.rank(),police:game.police,result:game.result,tour:game.tour,traffic:game.traffic.length,ai:game.ai.length})),metrics:()=>({frames:tickSamples.length,meanMs:tickSamples.reduce((a,b)=>a+b,0)/Math.max(1,tickSamples.length),workMeanMs:workSamples.reduce((a,b)=>a+b,0)/Math.max(1,workSamples.length),workP95Ms:workSamples.toSorted((a,b)=>a-b)[Math.floor(workSamples.length*.95)]||0,roadSlices:roadView?.samples.length||0})})});
  requestAnimationFrame(frame);
})();
