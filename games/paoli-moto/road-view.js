/* Perspective and crest occlusion shared by Canvas and geometry tests. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./game-core.js'):root.RR);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RoadView=api;
})(globalThis,function(RR){
  'use strict';
  const FOCAL=820,STEP=4,NEAR=3,FAR=1100,HORIZON=276,HEIGHT=720;
  function create(track,base,playerX,lateralV=0,speed=0){
    const camera=RR.roadAt(track,base),cameraPose=RR.cameraAt(track,base,playerX,camera,lateralV,speed),pitch=camera.grade*.65,samples=[];
    let center=0,heading=0,clip=HEIGHT;
    for(let z=NEAR;z<=FAR;z+=STEP){
      const road=RR.roadAt(track,base+z-7);
      heading+=road.curve*STEP;center+=heading*STEP*.5;
      const scale=FOCAL/(z+3),y=HORIZON+(3.8+camera.elevation-road.elevation)*scale+pitch*(FOCAL-10*scale);
      const x=640+(center-cameraPose.yaw*(z-7)-cameraPose.x)*scale;
      samples.push({z,x,y,scale,center,clip,width:road.width,lanes:road.lanes,sidewalk:road.sidewalk,theme:road.theme,count:road.count,left:road.left,right:road.right,l1:road.l1,r1:road.r1,l2:road.l2,r2:road.r2,junction:road.junction});
      clip=Math.min(clip,y);
    }
    function project(z,lateral=0){
      const index=RR.clamp(Math.floor((z-NEAR)/STEP),0,samples.length-2),a=samples[index],b=samples[index+1];
      const blend=RR.clamp((z-a.z)/STEP,0,1),center=a.center+(b.center-a.center)*blend;
      const scale=FOCAL/(Math.max(NEAR,z)+3),road=RR.roadAt(track,base+z-7);
      return {z,x:640+(center-cameraPose.yaw*(z-7)+lateral-cameraPose.x)*scale,y:HORIZON+(3.8+camera.elevation-road.elevation)*scale+pitch*(FOCAL-10*scale),scale,clip:a.clip};
    }
    return {samples,project,horizon:HORIZON+pitch*FOCAL};
  }
  function buildingSpan(z,length=16){
    if(z+length<=NEAR)return null;
    return {near:Math.max(NEAR,z),far:z+length,u:RR.clamp((NEAR-z)/length,0,1)};
  }
  return {create,buildingSpan};
});
