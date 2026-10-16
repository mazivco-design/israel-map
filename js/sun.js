/* sun.js — sun and moon: shadows, twilight, night, moonlight, run-the-day. All js/ files share one scope (plain scripts, loaded in order by index.html). */
/* ---------- sun and moon over a whole day (24 h, every half hour).
   Cast shadows of the sun are precomputed by tools/build_shadows.py (Israel only, while the sun is up);
   sun and moon positions, moon phase, twilight and night are computed here. ---------- */
let SUN=null;                 // shadows/manifest.json once loaded
const SITE=[35.0,31.5];
// four full-moon days: the moon rides highest in December and lowest in June (opposite to the sun)
const SUN_DAYS={'20261223':['דצמבר','23 בדצמבר 2026 · ירח מלא, כמעט מעל הראש'],'20270321':['מרץ','21 במרץ 2027 · ירח מלא, עולה במזרח'],
  '20270618':['יוני','18 ביוני 2027 · ירח מלא נמוך בדרום'],'20270915':['ספטמבר','15 בספטמבר 2027 · ירח מלא, עולה במזרח']};
const DAY=()=>SUN.dates[S.sunDate];
const SLOTS=48;               // 00:00 … 23:30
function sunFrames(){return SUN?DAY().frames:[];}
function sunUrl(f,half){return BASE+`shadows/${S.sunDate}/${f.f}-${half}.png`;}
function sunCoords(half){const [W,S_,E,N]=SUN.bounds,m=SUN.split;
  return half==='n'?[[W,N],[E,N],[E,m],[W,m]]:[[W,m],[E,m],[E,S_],[W,S_]];}

/* sky positions (formulas as in the SunCalc library, about 1° accurate) */
const RAD=Math.PI/180, OBL=RAD*23.4397;
const ra=(l,b)=>Math.atan2(Math.sin(l)*Math.cos(OBL)-Math.tan(b)*Math.sin(OBL),Math.cos(l));
const dec=(l,b)=>Math.asin(Math.sin(b)*Math.cos(OBL)+Math.cos(b)*Math.sin(OBL)*Math.sin(l));
function sunEq(d){const M=RAD*(357.5291+0.98560028*d),C=RAD*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M)),L=M+C+RAD*102.9372+Math.PI;
  return {ra:ra(L,0),dec:dec(L,0),dist:149598000};}
function moonEq(d){const L=RAD*(218.316+13.176396*d),M=RAD*(134.963+13.064993*d),F=RAD*(93.272+13.229350*d);
  const l=L+RAD*6.289*Math.sin(M),b=RAD*5.128*Math.sin(F);return {ra:ra(l,b),dec:dec(l,b),dist:385001-20905*Math.cos(M)};}
function horizontal(c,d,lng,lat){const H=RAD*(280.16+360.9856235*d)+RAD*lng-c.ra,phi=RAD*lat;
  const alt=Math.asin(Math.sin(phi)*Math.sin(c.dec)+Math.cos(phi)*Math.cos(c.dec)*Math.cos(H));
  const az=Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(c.dec)*Math.cos(phi));
  return {az:(az/RAD+180+360)%360,alt:alt/RAD};}
function skyAt(slot){
  const D=DAY(), date=Date.UTC(D.y,D.m-1,D.d,0,slot*30)-D.tz*3600e3, d=date/864e5-0.5+2440588-2451545;
  const s=sunEq(d),m=moonEq(d);
  const sun=horizontal(s,d,...SITE),moon=horizontal(m,d,...SITE);
  // lit fraction of the moon and whether it is growing (for the phase symbol)
  const phi=Math.acos(Math.sin(s.dec)*Math.sin(m.dec)+Math.cos(s.dec)*Math.cos(m.dec)*Math.cos(s.ra-m.ra));
  const inc=Math.atan2(s.dist*Math.sin(phi),m.dist-s.dist*Math.cos(phi));
  const ang=Math.atan2(Math.cos(s.dec)*Math.sin(s.ra-m.ra),Math.sin(s.dec)*Math.cos(m.dec)-Math.cos(s.dec)*Math.sin(m.dec)*Math.cos(s.ra-m.ra));
  moon.frac=(1+Math.cos(inc))/2; moon.phase=0.5+0.5*inc*(ang<0?-1:1)/Math.PI;
  return {sun,moon};
}
const slotTime=i=>String(Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'30':'00');
const MOON_ICONS=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const rgba=(c,a)=>`rgba(${c.map(Math.round).join(',')},${a.toFixed(3)})`;
const clamp01=x=>Math.max(0,Math.min(1,x));

/* how the scene is lit at one moment: a color veil over the ground (orange at dusk, deep blue at night)
   and one light for the slope shading (the sun by day, the moon at night) */
function lightAt(sky){
  const a=sky.sun.alt, mo=sky.moon;
  const moonGlow=mo.alt>0?mo.frac*clamp01(Math.sin(mo.alt*RAD)*2.5):0;   // 0 … 1
  const NIGHT=[8,14,40], DUSK=[255,128,80], GOLD=[255,170,90];
  let veil=[0,0,0],op=0,light='sun';
  if(a>=6){op=0;}
  else if(a>=0){veil=GOLD;op=.16*(1-a/6);}                                 // golden hour
  else if(a>=-6){const t=-a/6;veil=mix(DUSK,NIGHT,t);op=.28+.52*t;}         // sunset / dawn glow
  else{const t=clamp01((-a-6)/12);veil=NIGHT;op=.82+.11*t;light='moon';}     // night, darker until -18°
  if(light==='moon')op-=.2*moonGlow;                                       // a bright high moon lifts the dark
  return {veil,op,light,moonGlow};
}
const WORLD={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]]}};
function setSun(){
  if(!map.getLayer('shade'))return;
  const on=S.sun&&SUN, sky=on&&skyAt(S.sunI), f=on&&sunFrames().find(x=>x.t===slotTime(S.sunI));
  // cast shadows (only while the sun is up)
  if(f){
    for(const h of ['n','s']){
      const id='sun-'+h,src=map.getSource(id);
      if(src){if(src.url!==sunUrl(f,h))src.updateImage({url:sunUrl(f,h),coordinates:sunCoords(h)});}
      else{map.addSource(id,{type:'image',url:sunUrl(f,h),coordinates:sunCoords(h)});
        map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.38,'raster-fade-duration':0,'raster-resampling':'linear'}},'river');}  // above the sea and lakes, so shade on water shows
    }
  }else for(const h of ['n','s'])if(map.getLayer('sun-'+h)){map.removeLayer('sun-'+h);map.removeSource('sun-'+h);}
  if(!on){
    for(const k in SHADE_MULTI)map.setPaintProperty('shade',k,SHADE_MULTI[k]);
    if(map.getLayer('moonlit'))map.removeLayer('moonlit');
    if(map.getLayer('night')){map.removeLayer('night');map.removeSource('night');}
    return;
  }
  const L=lightAt(sky);
  // slope shading from one light; below ~15° flat ground would turn almost black, the low light shows in the long shadows instead
  let P;
  if(L.light==='sun')P={dir:sky.sun.az,alt:Math.max(sky.sun.alt,15),hi:'rgba(255,240,210,0.30)',sh:'rgba(10,14,30,0.6)'};
  // moonlight: silver on the slopes facing the moon, deep dark on the others
  else if(sky.moon.alt>0)P={dir:sky.moon.az,alt:Math.max(sky.moon.alt,10),hi:`rgba(215,228,255,${(.7*L.moonGlow).toFixed(3)})`,sh:`rgba(0,2,12,${(.4+.4*L.moonGlow).toFixed(3)})`};
  else P={dir:315,alt:45,hi:'rgba(0,0,0,0)',sh:'rgba(0,2,12,0.3)'};   // no moon: only a faint relief
  const Q={'hillshade-method':'standard','hillshade-illumination-anchor':'map','hillshade-illumination-direction':P.dir,
    'hillshade-illumination-altitude':P.alt,'hillshade-highlight-color':P.hi,'hillshade-shadow-color':P.sh};
  for(const k in Q)map.setPaintProperty('shade',k,Q[k]);
  // the veil sits over ground, water and shadows, under roads and names (they stay readable at night)
  if(!map.getSource('night'))map.addSource('night',{type:'geojson',data:WORLD});
  if(!map.getLayer('night'))map.addLayer({id:'night',type:'fill',source:'night',paint:{'fill-color':'#000','fill-opacity':0,'fill-opacity-transition':{duration:0},'fill-color-transition':{duration:0}}},'river');
  map.setPaintProperty('night','fill-color',rgba(L.veil,1));
  map.setPaintProperty('night','fill-opacity',Math.max(0,L.op));
  // moonlight is painted over the dark veil, so moon-facing slopes glow silver out of the night.
  // A high moon lights everything evenly; a low moon lights only the slopes that face it.
  const moonOn=L.light==='moon'&&sky.moon.alt>0&&L.moonGlow>.02;
  if(moonOn){
    if(!map.getLayer('moonlit'))map.addLayer({id:'moonlit',type:'hillshade',source:'demShade',paint:{'hillshade-method':'basic','hillshade-illumination-anchor':'map',
      'hillshade-shadow-color':'rgba(0,0,0,0)','hillshade-accent-color':'rgba(0,0,0,0)','hillshade-highlight-color':'rgba(0,0,0,0)','hillshade-highlight-color-transition':{duration:0}}},'river');
    map.setPaintProperty('moonlit','hillshade-illumination-direction',sky.moon.az);
    map.setPaintProperty('moonlit','hillshade-illumination-altitude',Math.max(sky.moon.alt,5));
    map.setPaintProperty('moonlit','hillshade-highlight-color',`rgba(200,216,255,${(.3*L.moonGlow).toFixed(3)})`);
  }else if(map.getLayer('moonlit'))map.removeLayer('moonlit');
}
// a new shadow image is drawn on the 3D ground only after the draped texture is refreshed
map.on('sourcedata',e=>{if(e.sourceId&&e.sourceId.startsWith('sun-')&&e.isSourceLoaded)refreshTerrain();});
function showSunTime(){
  if(!SUN){$('sunv').textContent='—';$('sunnote').textContent='';return;}
  const sky=skyAt(S.sunI),s=sky.sun,m=sky.moon;
  $('sunv').textContent=slotTime(S.sunI);
  const icon=MOON_ICONS[Math.round(m.phase*8)%8], moonTxt=`${icon} ירח ${Math.round(m.frac*100)}% מואר`+(m.alt>0?`, בגובה ${Math.round(m.alt)}°`:', מתחת לאופק');
  $('sunnote').textContent=s.alt>0?`☀ שמש בגובה ${Math.round(s.alt)}°`+(m.alt>0?` · ${moonTxt}`:'')
    :(s.alt>-6?'דמדומים · ':'לילה · ')+moonTxt;
}
function setSunI(i){S.sunI=(i+SLOTS)%SLOTS;$('sunt').value=S.sunI;showSunTime();setSun();refreshTerrain();}
async function loadSun(){
  if(SUN)return true;
  try{const r=await fetch(BASE+'shadows/manifest.json');if(!r.ok)throw 0;SUN=await r.json();}catch(e){return false;}
  $('sunt').max=SLOTS-1;
  // date buttons; start with the day closest in the year to today
  const doy=x=>{const t=new Date(x.y,x.m-1,x.d);return (t-new Date(t.getFullYear(),0,0))/864e5;};
  const today=doy({y:2001,m:new Date().getMonth()+1,d:new Date().getDate()});
  let best=1e9;
  for(const k in SUN.dates){
    const b=document.createElement('button');b.textContent=SUN_DAYS[k]?SUN_DAYS[k][0]:k;b.dataset.k=k;b.setAttribute('aria-pressed','false');
    b.onclick=()=>setSunDate(k);$('sundates').append(b);
    const dd=Math.abs(doy({...SUN.dates[k],y:2001})-today),gap=Math.min(dd,365-dd);if(gap<best){best=gap;S.sunDate=k;}
  }
  markSunDate();
  // start at the current time of day
  const now=new Date();S.sunI=now.getHours()*2+(now.getMinutes()>=30?1:0);
  preloadSun();
  return true;
}
// fetch every shadow frame of the day in the background so moving the slider is instant
// (fetch only fills the browser cache with the small compressed files; decoding them all at once would eat iPad memory)
function preloadSun(){sunFrames().forEach(f=>['n','s'].forEach(h=>fetch(sunUrl(f,h)).catch(()=>{})));}
function markSunDate(){
  document.querySelectorAll('#sundates button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.k===S.sunDate));
  $('sundate').textContent=(SUN_DAYS[S.sunDate]||[,''])[1];
}
function setSunDate(k){S.sunDate=k;markSunDate();preloadSun();showSunTime();setSun();refreshTerrain();}
/* "run the day": half an hour every 0.5 s, round and round until pressed again.
   A step waits (up to 2 s) while the previous shadow image is still loading, so a slow device never piles up work. */
let playT=null;
function setPlay(on){
  clearTimeout(playT);playT=null;press('sun-play',on);$('sun-play').textContent=on?'⏸ עצירה':'▶ הרץ את היום';
  if(on){
    let waited=0;
    const step=()=>{
      if(!playT)return;
      const busy=['sun-n','sun-s'].some(id=>map.getSource(id)&&!map.isSourceLoaded(id));
      if(busy&&waited<2000){waited+=100;playT=setTimeout(step,100);return;}
      waited=0;setSunI(S.sunI+1);playT=setTimeout(step,500);
    };
    playT=setTimeout(step,0);
  }
}
// if the browser drops the map's graphics (it happens on iPads short of memory) stop the animation; MapLibre redraws when it comes back
map.getCanvas().addEventListener('webglcontextlost',()=>{if(playT)setPlay(false);});
map.getCanvas().addEventListener('webglcontextrestored',()=>{setTimeout(()=>{apply();refreshTerrain();},300);});
$('sun-play').onclick=()=>setPlay(!playT);
$('b-sun').onclick=async()=>{
  if(!S.sun&&!(await loadSun())){showMsg('קובץ הצללים לא נטען.');return;}
  S.sun=!S.sun;press('b-sun',S.sun);$('sunctl').hidden=!S.sun;
  if(!S.sun)setPlay(false);
  if(S.sun){$('sunt').value=S.sunI;showSunTime();}
  apply();
};
// moving the time by hand stops the animation
$('sunt').addEventListener('input',e=>{if(playT)setPlay(false);setSunI(+e.target.value);});
$('sun-minus').onclick=()=>{if(playT)setPlay(false);setSunI(S.sunI-1);};
$('sun-plus').onclick=()=>{if(playT)setPlay(false);setSunI(S.sunI+1);};

map.on('error',e=>{
  if(e.sourceId!=='marked'||markedFailed)return;
  markedFailed=true;setMarked(false);refreshTerrain();
  showMsg('שכבת המסלולים המסומנים לא זמינה כרגע. מוצגים השבילים מהמפה בלבד.');
});
