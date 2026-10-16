/* flight.js — camera flight along a picked route, and a tour between points. All js/ files share one scope. */

/* The flight moves a position along the profile's points (PROF.pts). Each frame the camera is placed a little
   behind that position, looking along the route, with a smoothed heading so bends do not jerk.
   Speed is in route-km per real second; "low" view sits near the ground, "high" is a wider look. */
const FLY={on:false,pos:0,speed:1,view:'low',raf:0,last:0,bearing:null,tour:null};
const FLY_KMPS={1:.08,2:.16,4:.32};                       // ×1: a 10 km trail takes about 2 minutes

function flyUi(){
  $('fly-play').textContent=FLY.on?'⏸ עצירה':'▶ טיסה';press('fly-play',FLY.on);
  for(const v of [1,2,4])press('fly-x'+v,FLY.speed===v);
  press('fly-low',FLY.view==='low');press('fly-high',FLY.view==='high');
}
function routePos(d){            // interpolated point on the route at distance d (km)
  const P=PROF.pts;let lo=0,hi=P.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(P[m].d<d)lo=m;else hi=m;}
  const a=P[lo],b=P[hi],t=b.d>a.d?(d-a.d)/(b.d-a.d):0;
  return {lng:a.lng+(b.lng-a.lng)*t,lat:a.lat+(b.lat-a.lat)*t,z:a.z+(b.z-a.z)*t,i:t<.5?lo:hi};
}
function headingAt(d){           // direction of travel (deg clockwise from north) a little ahead of d
  const a=routePos(d),b=routePos(Math.min(PROF.L,d+.25));
  const dx=(b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),dy=b.lat-a.lat;
  return dx||dy?(Math.atan2(dx,dy)*180/Math.PI+360)%360:(FLY.bearing??0);
}
function lerpAngle(a,b,t){let d=((b-a+540)%360)-180;return (a+d*t+360)%360;}
function flyFrame(now){
  if(!FLY.on)return;
  const dt=Math.min(.25,(now-FLY.last)/1000);FLY.last=now;
  FLY.pos+=dt*FLY_KMPS[FLY.speed]*S.ex/2;              // scaled with exaggeration a little, so tall views do not crawl
  if(FLY.pos>=PROF.L){FLY.pos=PROF.L;flyStop();placeCamera(FLY.pos);return;}
  placeCamera(FLY.pos);
  FLY.raf=requestAnimationFrame(flyFrame);
}
function placeCamera(d){
  const p=routePos(d),h=headingAt(d);
  FLY.bearing=FLY.bearing==null?h:lerpAngle(FLY.bearing,h,.06);
  const low=FLY.view==='low';
  // the camera hangs behind the point (along the smoothed heading) and above the ground there, looking at a spot
  // a little short of the point, so the point itself shows in the open part of the screen above the chart
  const back=low?.6:1.8, height=low?220:1000, rad=Math.PI/180, bl=(FLY.bearing+180)*rad;
  const cam=[p.lng+Math.sin(bl)*back/(111.32*Math.cos(p.lat*rad)),p.lat+Math.cos(bl)*back/110.57];
  const ground=ll=>{const z=map.queryTerrainElevation(ll);return isFinite(z)?z:0;};
  const k=.45, look=[p.lng-(p.lng-cam[0])*k,p.lat-(p.lat-cam[1])*k];
  try{map.jumpTo(map.calculateCameraOptionsFromTo(cam,ground(cam)+height,look,ground(look)));}
  catch(e){map.jumpTo({center:[p.lng,p.lat],bearing:FLY.bearing,pitch:low?70:55,zoom:low?14:12.5});}
  // keep the moving dot and the profile in step
  PROF.hover=p.i;
  if(!PROF.hoverMarker){const el=document.createElement('div');el.className='profdot';PROF.hoverMarker=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map);}
  PROF.hoverMarker.setLngLat([p.lng,p.lat]);drawProfile();
}
function flyStart(){
  if(!PROF.pts)return;
  if(FLY.pos>=PROF.L-1e-6)FLY.pos=0;
  FLY.on=true;FLY.last=performance.now();FLY.bearing=map.getBearing();
  if(playT)setPlay(false);                                  // the sun animation and the flight do not run together
  flyUi();FLY.raf=requestAnimationFrame(flyFrame);
}
function flyStop(){FLY.on=false;cancelAnimationFrame(FLY.raf);if(FLY.tour){clearTimeout(FLY.tour);FLY.tour=null;}flyUi();}
$('fly-play').onclick=()=>FLY.on?flyStop():flyStart();
for(const v of [1,2,4])$('fly-x'+v).onclick=()=>{FLY.speed=v;flyUi();};
$('fly-low').onclick=()=>{FLY.view='low';flyUi();if(FLY.on)placeCamera(FLY.pos);};
$('fly-high').onclick=()=>{FLY.view='high';flyUi();if(FLY.on)placeCamera(FLY.pos);};
// any touch on the map hands control back
for(const ev of ['mousedown','touchstart','wheel'])map.getCanvas().addEventListener(ev,()=>{if(FLY.on)flyStop();},{passive:true});
// tapping the chart moves the flight there
$('profcv').addEventListener('pointerdown',e=>{if(PROF.pts){FLY.pos=PROF.pts[profIndex(e)].d;if(FLY.on)placeCamera(FLY.pos);}});

/* tour: the camera glides from stop to stop and pauses at each. Stops are the profile's marked points
   (in route order) or the elevation pins (in the order they were set). */
function tour(stops,label){
  if(stops.length<2){showMsg('לסיור צריך לפחות שתי נקודות.');return;}
  flyStop();FLY.on=true;flyUi();
  let i=0;
  const step=()=>{
    if(!FLY.on)return;
    const s=stops[i];
    label(i);
    map.flyTo({center:[s.lng,s.lat],zoom:13.5,pitch:62,bearing:map.getBearing()+25,duration:2600,essential:true});
    FLY.tour=setTimeout(()=>{i++;if(i<stops.length)step();else flyStop();},2600+2200);
  };
  step();
}
$('fly-tour').onclick=()=>{
  const M=PROF.marks.slice().sort((a,b)=>a-b).map(j=>PROF.pts[j]);
  tour(M,i=>{PROF.hover=PROF.marks.sort((a,b)=>a-b)[i];drawProfile();});
};
$('b-tour').onclick=()=>{
  flyStop();
  if(pins.length<2){$('lastnote').textContent='לסיור צריך לפחות שתי נקודות גובה.';return;}
  tour(pins,i=>{$('last').textContent=hText(pins[i]);$('lastco').textContent=`נקודה ${i+1} מתוך ${pins.length}`;});
};
