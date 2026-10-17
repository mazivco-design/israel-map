/* flight.js — camera flight along a picked route, and a tour between points. All js/ files share one scope. */

/* The flight moves a position along the profile's points (PROF.pts). Each frame the camera is placed a little
   behind that position, looking along the route, with a smoothed heading so bends do not jerk.
   Speed is in route-km per real second; "low" view sits near the ground, "high" is a wider look. */
const FLY={on:false,pos:0,speed:1,view:'low',raf:0,last:0,bearing:null,alt:null,tour:null,
  follow:false,          // "עקוב": scrubbing the chart carries the camera along
  cam:null,              // the viewer's own camera, captured when they move the map in follow mode (see captureCam)
  dirMode:'route'};      // 'route': the view turns with the trail; 'fixed': it keeps the compass direction the viewer set
const FLY_KMPS={1:.08,2:.16,4:.32};                       // ×1: a 10 km trail takes about 2 minutes

function flyUi(){
  $('prof').classList.toggle('flying',FLY.on);drawProfile();
  $('fly-play').textContent=FLY.on?'⏸ עצירה':'▶ טיסה';press('fly-play',FLY.on);
  for(const v of [1,2,4])press('fly-x'+v,FLY.speed===v);
  press('fly-low',!FLY.cam&&FLY.view==='low');press('fly-high',!FLY.cam&&FLY.view==='high');
  press('fly-follow',FLY.follow);press('fly-dir',FLY.dirMode==='fixed');
  $('fly-dir').textContent=FLY.dirMode==='fixed'?'כיוון קבוע':'כיוון עם הדרך';
  $('fly-note').textContent=FLY.cam?'המצלמה בזווית שקבעת. "קרוב" או "מלמעלה" מחזירים למבט הרגיל.':FLY.follow?'סובב, הטה או קרב את המפה כרצונך; מכאן המצלמה תשמור על הזווית הזאת לאורך המסלול.':'';
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
/* the viewer's own camera, relative to the moving point: zoom, pitch, the direction (relative to the trail's heading
   or fixed), and where the point sits on screen (as a ground offset from the map centre, turned with the heading) */
function captureCam(){
  if(!PROF.pts)return;
  const p=routePos(FLY.pos),h=headingAt(FLY.pos),c=map.getCenter(),rad=Math.PI/180;
  const dx=(c.lng-p.lng)*111.32*Math.cos(p.lat*rad),dy=(c.lat-p.lat)*110.57;      // km, east/north
  const ang=Math.atan2(dx,dy)*180/Math.PI;                                            // bearing of the offset
  FLY.cam={zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing(),bearingRel:((map.getBearing()-h)%360+360)%360,
    offDist:Math.hypot(dx,dy),offRel:((ang-h)%360+360)%360};
  FLY.bearing=map.getBearing();flyUi();
}
function placeCamera(d,immediate){
  const p=routePos(d),h=headingAt(d);
  if(FLY.cam){
    const C=FLY.cam,rad=Math.PI/180;
    const want=C.bearingRel!=null&&FLY.dirMode==='route'?(h+C.bearingRel)%360:C.bearing;
    FLY.bearing=FLY.bearing==null||immediate?want:lerpAngle(FLY.bearing,want,.08);
    // the point keeps its place on screen: the centre is offset from it the same way, turned with the current bearing
    const a=(FLY.dirMode==='route'?h+C.offRel:C.bearing-C.bearingRel+C.offRel)*rad;
    const center=[p.lng+Math.sin(a)*C.offDist/(111.32*Math.cos(p.lat*rad)),p.lat+Math.cos(a)*C.offDist/110.57];
    map.jumpTo({center,zoom:C.zoom,pitch:C.pitch,bearing:FLY.bearing});
    PROF.hover=p.i;
    if(!PROF.hoverMarker){const el=document.createElement('div');el.className='profdot';PROF.hoverMarker=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map);}
    PROF.hoverMarker.setLngLat([p.lng,p.lat]);drawProfile();
    return;
  }
  FLY.bearing=FLY.bearing==null||immediate?h:lerpAngle(FLY.bearing,h,.06);
  const low=FLY.view==='low';
  // a drone-like view: the camera trails the point by about a kilometre, not far above the ground, looking
  // almost at the horizon so the hills stand up against the sky. "high" is further back and higher.
  const back=low?1.1:2.8, height=low?140:900, rad=Math.PI/180, bl=(FLY.bearing+180)*rad;
  const cam=[p.lng+Math.sin(bl)*back/(111.32*Math.cos(p.lat*rad)),p.lat+Math.cos(bl)*back/110.57];
  const ground=ll=>{const z=map.queryTerrainElevation(ll);return isFinite(z)?z:0;};
  // the camera's own height follows the ground under it, but smoothed, so it does not bob on every bump,
  // and never drops below the point it is looking at
  const gz=ground(cam),pz=ground([p.lng,p.lat]);
  const wantAlt=Math.max(gz+height,pz+height*.6);
  FLY.alt=FLY.alt==null?wantAlt:FLY.alt+(wantAlt-FLY.alt)*.08;
  // look at a spot short of the point, so the point shows in the open part of the screen above the chart
  const k=.4, look=[p.lng-(p.lng-cam[0])*k,p.lat-(p.lat-cam[1])*k];
  try{
    const o=map.calculateCameraOptionsFromTo(cam,FLY.alt,look,ground(look));
    if(o.pitch>79)o.pitch=79;                           // the map allows 80°; a hair less keeps the sky in view without clamping jumps
    map.jumpTo(o);
  }catch(e){map.jumpTo({center:[p.lng,p.lat],bearing:FLY.bearing,pitch:low?75:60,zoom:low?14:12.5});}
  // keep the moving dot and the profile in step
  PROF.hover=p.i;
  if(!PROF.hoverMarker){const el=document.createElement('div');el.className='profdot';PROF.hoverMarker=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map);}
  PROF.hoverMarker.setLngLat([p.lng,p.lat]);drawProfile();
}
function flyStart(){
  if(!PROF.pts)return;
  if(FLY.pos>=PROF.L-1e-6)FLY.pos=0;
  FLY.on=true;FLY.last=performance.now();FLY.bearing=map.getBearing();FLY.alt=null;
  if(playT)setPlay(false);                                  // the sun animation and the flight do not run together
  flyUi();FLY.raf=requestAnimationFrame(flyFrame);
}
function flyStop(){FLY.on=false;cancelAnimationFrame(FLY.raf);if(FLY.tour){clearTimeout(FLY.tour);FLY.tour=null;}flyUi();}
$('fly-play').onclick=()=>FLY.on?flyStop():flyStart();
for(const v of [1,2,4])$('fly-x'+v).onclick=()=>{FLY.speed=v;flyUi();};
$('fly-low').onclick=()=>{FLY.view='low';FLY.cam=null;FLY.alt=null;flyUi();if(FLY.on||FLY.follow)placeCamera(FLY.pos,true);};
$('fly-high').onclick=()=>{FLY.view='high';FLY.cam=null;FLY.alt=null;flyUi();if(FLY.on||FLY.follow)placeCamera(FLY.pos,true);};
$('fly-follow').onclick=()=>{FLY.follow=!FLY.follow;flyUi();if(FLY.follow&&PROF.pts)placeCamera(FLY.pos,true);};
$('fly-dir').onclick=()=>{FLY.dirMode=FLY.dirMode==='route'?'fixed':'route';flyUi();if(FLY.cam&&(FLY.on||FLY.follow))placeCamera(FLY.pos,true);};
// any touch on the map hands control back (the flight stops; in follow mode the new view is then captured, below)
for(const ev of ['mousedown','touchstart','wheel'])map.getCanvas().addEventListener(ev,()=>{if(FLY.on)flyStop();},{passive:true});
// in follow mode, a view the viewer set by hand becomes the camera for the rest of the route
for(const ev of ['dragend','zoomend','rotateend','pitchend'])map.on(ev,e=>{if(FLY.follow&&PROF.pts&&e.originalEvent)captureCam();});
// a tap on the chart moves the flight there; in follow mode scrubbing carries the camera along
$('profcv').addEventListener('pointerdown',e=>{if(PROF.pts){FLY.pos=PROF.pts[profIndex(e)].d;if(FLY.on||FLY.follow)placeCamera(FLY.pos,!FLY.on);}});
$('profcv').addEventListener('pointermove',e=>{if(PROF.pts&&FLY.follow&&!FLY.on&&(e.buttons||e.pointerType!=='mouse')){FLY.pos=PROF.pts[profIndex(e)].d;placeCamera(FLY.pos,true);}});

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
