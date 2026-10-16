/* search.js — search (places / trails / roads), picked things, "my selections". All js/ files share one scope (plain scripts, loaded in order by index.html). */
/* ---------- search (OpenStreetMap Nominatim; one request per search, as its usage policy asks) ---------- */
const TYPE_HE={city:'עיר',town:'עיירה',village:'יישוב',hamlet:'יישוב',suburb:'שכונה',neighbourhood:'שכונה',peak:'פסגה',hill:'גבעה',
  ridge:'רכס',valley:'עמק',stream:'נחל',river:'נהר',wadi:'ואדי',spring:'מעיין',hiking:'מסלול הליכה',bicycle:'מסלול אופניים',
  water:'מקום מים',lake:'אגם',cave_entrance:'מערה',viewpoint:'תצפית',nature_reserve:'שמורת טבע',national_park:'גן לאומי',
  attraction:'אטרקציה',archaeological_site:'אתר עתיקות',cliff:'מצוק',crater:'מכתש',administrative:'אזור'};
const results=$('results'),smsg=$('smsg');
let searching=false;
function showMsg(t){smsg.textContent=t;smsg.hidden=!t;}
/* several search results can stay on the map together, each in its own color (a marked trail in its own marking color) */
const FCOLORS=['#ff8a3d','#4fd1ff','#ff5fa2','#b6f25c','#ffd166','#c49bff','#ff6b5b','#5cf2c1'];
const picked=new Map();   // osm key -> {name,kind,color,geometry,bbox,km}
let colorIx=0;
const keyOf=r=>r.osm_type+r.osm_id;
function syncFound(){
  FOUND=fc([...picked.entries()].map(([k,p])=>({type:'Feature',properties:{key:k,name:p.name,color:p.color},geometry:p.geometry})));
  const src=map.getSource('found');if(src)src.setData(FOUND);
  refreshTerrain();renderMine();
}
function fitBox([w,s,e,n],maxZoom=14){
  if(n-s<0.01&&e-w<0.01)map.flyTo({center:[(w+e)/2,(s+n)/2],zoom:13.5,pitch:60,duration:2000});
  else map.fitBounds([[w,s],[e,n]],{padding:{top:160,bottom:200,left:60,right:60},pitch:50,duration:2000,maxZoom});
}
let lastList=[];
function markResults(){[...results.querySelectorAll('button')].forEach((b,i)=>{const r=lastList[i];if(!r)return;
  b.classList.toggle('on',r.road?S.roadSel.has(r.road):picked.has(keyOf(r)));});}
const TRAIL_COLORS={red:'#e8443a',blue:'#2f7fe0',green:'#2fae4a',black:'#3a3a3a',orange:'#ff8a3d',yellow:'#f2c230',purple:'#9b59d0',white:'#f4f4f4',brown:'#9a6b3c'};
function trailColor(name,t){
  if(/שביל ישראל/.test(name||'')||/israel national trail/i.test(t['name:en']||''))return TRAIL_COLORS.orange;
  const c=((t['osmc:symbol']||'').split(':')[0]||t.colour||'').toLowerCase();
  return TRAIL_COLORS[c]||(/^#[0-9a-f]{3,6}$/.test(c)?c:null);
}
function km(g){let d=0;const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
  for(const l of lines)for(let i=1;i<l.length;i++){const a=l[i-1],b=l[i];
    d+=Math.hypot((b[0]-a[0])*Math.cos((a[1]+b[1])/2*Math.PI/180)*111.32,(b[1]-a[1])*110.57);}return d;}
const kmTxt=k=>k<10?k.toFixed(1):String(Math.round(k));
function pick(r){
  const k=keyOf(r);
  if(picked.has(k))picked.delete(k);
  else{
    const g=r.geojson&&r.geojson.type!=='Point'?r.geojson:{type:'Point',coordinates:[+r.lon,+r.lat]};
    const name=r.name||r.display_name.split(', ')[0],trail=r.category==='route';
    const color=(trail&&trailColor(name,r.extratags||{}))||FCOLORS[colorIx++%FCOLORS.length];
    picked.set(k,{name,kind:trail?'trail':'place',color,geometry:g,bbox:[+r.boundingbox[2],+r.boundingbox[0],+r.boundingbox[3],+r.boundingbox[1]],km:trail?km(g):0});
    fitBox(picked.get(k).bbox);showTab('mine');
  }
  syncFound();markResults();
}

/* marked trails: searched in trails/index.json (built from OpenStreetMap by build-trails.yml); a trail's lines load when it is picked */
let TRAILS=null;
async function loadTrails(){if(!TRAILS)TRAILS=await fetch(BASE+'trails/index.json').then(r=>r.ok?r.json():[]).catch(()=>[]);return TRAILS;}
const norm=s=>(s||'').toLowerCase().replace(/[\u0591-\u05C7"'״׳()\-–]/g,' ').replace(/\s+/g,' ').trim();
async function pickTrailEntry(r){
  const k=keyOf(r),t=r.trail;
  if(picked.has(k)){picked.delete(k);syncFound();markResults();return;}
  let g;try{g=await fetch(BASE+'trails/'+t.id+'.json').then(x=>{if(!x.ok)throw 0;return x.json();});}catch(e){showMsg('לא הצלחתי לטעון את השביל.');return;}
  picked.set(k,{name:t.n,kind:'trail',color:TRAIL_COLORS[t.c]||FCOLORS[colorIx++%FCOLORS.length],geometry:g,bbox:t.b,km:t.km});
  fitBox(t.b);showTab('mine');syncFound();markResults();
}

/* roads: several can be picked, each in its own color; taken whole from roads.geojson */
const ROAD_COLORS=['#ffe14d','#4fd1ff','#ff5fa2','#b6f25c','#c49bff','#ff9f43'];
const roadColor=new Map();
async function loadRoads(){if(!ROADS)ROADS=await fetch(BASE+'roads.geojson').then(r=>r.json()).catch(()=>({features:[]}));return ROADS;}
function roadBox(ref){let w=180,s=90,e=-180,n=-90;
  for(const f of ROADS.features)if(f.properties.ref===ref)for(const l of f.geometry.coordinates)for(const [x,y] of l){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}
  return [w,s,e,n];}
async function toggleRoad(ref,fly){
  await loadRoads();
  if(S.roadSel.has(ref)){S.roadSel.delete(ref);roadColor.delete(ref);}
  else{
    S.roadSel.add(ref);
    const used=new Set(roadColor.values());roadColor.set(ref,ROAD_COLORS.find(c=>!used.has(c))||ROAD_COLORS[S.roadSel.size%ROAD_COLORS.length]);
    if(!S.roads){S.roads=true;press('b-roads',true);}
    if(fly)fitBox(roadBox(ref),12);
    showTab('mine');
  }
  ROADPICK=fc(ROADS.features.filter(f=>S.roadSel.has(f.properties.ref)).map(f=>({...f,properties:{...f.properties,color:roadColor.get(f.properties.ref)}})));
  apply();renderMine();markResults();
}
const ROAD_CLASS_HE={motorway:'כביש מהיר',trunk:'כביש ראשי',primary:'כביש ראשי',secondary:'כביש אזורי',tertiary:'כביש מקומי'};

/* search: places, marked trails, or road numbers */
const STYPES={place:['s-place','שם של ישוב, הר או מקום'],trail:['s-trail','שם של שביל, למשל נחל עמוד'],road:['s-road','מספר כביש, למשל 90']};
function setStype(t){S.stype=t;for(const k in STYPES)press(STYPES[k][0],k===t);$('q').placeholder=STYPES[t][1];$('q').inputMode=t==='road'?'numeric':'text';
  results.hidden=true;showMsg('');}
for(const k in STYPES)$(STYPES[k][0]).onclick=()=>setStype(k);
function showResults(list,label,onPick){
  results.textContent='';lastList=list;
  for(const r of list){
    const li=document.createElement('li'),b=document.createElement('button');b.type='button';
    const [nm,desc,dot]=label(r);
    const n=document.createElement('span');n.className='rn';
    if(dot){const i=document.createElement('i');i.style.cssText=`display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot};margin-inline-end:6px`;n.append(i);}
    n.append(nm);
    const d=document.createElement('span');d.className='rd';d.textContent=desc;
    b.append(n,d);b.onclick=()=>onPick(r);li.append(b);results.append(li);
  }
  results.hidden=false;markResults();
}
$('sform').addEventListener('submit',async e=>{
  e.preventDefault();
  const q=$('q').value.trim();if(!q||searching)return;
  if(S.stype==='road'){
    await loadRoads();
    const num=q.replace(/[^0-9]/g,'');
    const refs=ROADS.features.map(f=>f.properties).filter(p=>num&&(p.ref===num||p.ref.startsWith(num)))
      .sort((a,b)=>(a.ref===num?0:1)-(b.ref===num?0:1)||a.ref.length-b.ref.length||a.ref.localeCompare(b.ref)).slice(0,10);
    if(!refs.length){results.hidden=true;showMsg('לא מצאתי כביש עם המספר הזה באזור ישראל.');return;}
    showMsg(refs.length>1?'אפשר לבחור כמה כבישים. כל אחד יסומן בצבע משלו.':'');
    showResults(refs.map(p=>({road:p.ref,cls:p.class})),r=>['כביש '+r.road,ROAD_CLASS_HE[r.cls]||'כביש',roadColor.get(r.road)],r=>toggleRoad(r.road,true));
    if(refs.length===1&&refs[0].ref===num&&!S.roadSel.has(num))toggleRoad(num,true);
    return;
  }
  if(S.stype==='trail'){
    await loadTrails();
    if(!TRAILS.length){showMsg('רשימת השבילים לא נטענה. נסו לרענן את הדף.');return;}
    const words=norm(q).split(' ').filter(Boolean);
    const hits=TRAILS.map(t=>{const h=norm(t.n+' '+(t.en||''));if(!words.every(w=>h.includes(w)))return null;
        return {t,score:norm(t.n).startsWith(words[0])?0:1};}).filter(Boolean)
      .sort((a,b)=>a.score-b.score||b.t.km-a.t.km).slice(0,15).map(x=>({osm_type:'t',osm_id:x.t.id,trail:x.t}));
    if(!hits.length){results.hidden=true;showMsg('לא מצאתי שביל מסומן בשם הזה. נסו חלק מהשם, למשל "עמוד" או "הגולן".');return;}
    showMsg(hits.length>1?'אפשר לבחור כמה שבילים. כל אחד יסומן בצבע הסימון שלו.':'');
    showResults(hits,r=>[r.trail.n,`שביל מסומן · ${kmTxt(r.trail.km)} ק״מ`,TRAIL_COLORS[r.trail.c]||'#ff8a3d'],pickTrailEntry);
    return;
  }
  searching=true;results.hidden=true;showMsg('מחפש…');
  const trail=false;
  try{
    const u='https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'jsonv2','accept-language':'he',limit:trail?'25':'10',
      polygon_geojson:'1',polygon_threshold:'0.0003',extratags:'1',viewbox:'34.2,33.4,35.95,29.4',bounded:'0'});
    const res=await fetch(u);if(!res.ok)throw new Error(res.status);
    const list=(await res.json()).filter(r=>trail?r.category==='route':r.category!=='route').slice(0,10);
    if(!list.length){showMsg(trail?'לא מצאתי שביל מסומן בשם הזה. נסו חלק מהשם, למשל "נחל דוד" או "שביל הגולן".':'לא נמצאו תוצאות. נסו שם אחר או כתיב אחר.');return;}
    showMsg(list.length>1?'אפשר לבחור כמה תוצאות. כל אחת תסומן בצבע משלה.':'');
    showResults(list,r=>{const parts=r.display_name.split(', ');
      const g=r.geojson||{};const k=trail&&g.type&&g.type!=='Point'?kmTxt(km(g))+' ק״מ':'';
      return [r.name||parts[0],[trail?'שביל מסומן':TYPE_HE[r.type],k,parts.slice(1,3).join(', ')].filter(Boolean).join(' · '),trail?trailColor(r.name,r.extratags||{}):null];},pick);
  }catch(err){showMsg('החיפוש לא הצליח. בדקו את החיבור לאינטרנט ונסו שוב בעוד רגע.');}
  finally{searching=false;}
});
$('q').addEventListener('input',()=>{if(!$('q').value){results.hidden=true;showMsg('');}});

/* ---------- "my selections": everything picked, in one list ---------- */
function showTab(t){
  press('t-mine',t==='mine');press('t-pins',t==='pins');
  $('pane-mine').hidden=t!=='mine';$('pane-pins').hidden=t!=='pins';$('rows').hidden=t!=='pins';
  $('b-clear').hidden=t==='mine'?!mineCount():!pins.length;
  $('b-clear').textContent=t==='mine'?'ניקוי הכול':'ניקוי';
}
$('t-mine').onclick=()=>showTab('mine');
$('t-pins').onclick=()=>showTab('pins');
const tabNow=()=>$('pane-mine').hidden?'pins':'mine';
const mineCount=()=>S.sel.size+picked.size+S.roadSel.size;
function renderMine(){
  const ul=$('mine');ul.textContent='';
  const add=(color,name,kind,fly,remove,chart)=>{
    const li=document.createElement('li'),i=document.createElement('i'),go=document.createElement('button'),x=document.createElement('button');
    i.style.background=color;go.className='go';x.className='x';
    const b=document.createElement('b');b.textContent=name;const k=document.createElement('span');k.textContent=kind;go.append(b,k);go.onclick=fly;
    x.textContent='×';x.setAttribute('aria-label','הסרת '+name);x.onclick=remove;
    const c=document.createElement('button');c.className='chart';c.textContent='📈';c.title='גרף גובה ושיפוע';c.setAttribute('aria-label','גרף גובה של '+name);
    if(chart)c.onclick=chart;else c.style.visibility='hidden';
    li.append(i,go,c,x);ul.append(li);
  };
  let area=0;
  for(const id of S.sel){const f=AREAS.get(id);if(!f)continue;area+=f.properties.area||0;
    add('#ffd166',f.properties.name,{countries:'מדינה',land:'נוף',regions:'אזור'}[areaKind(id)]+` · כ־${Math.round(f.properties.area).toLocaleString('he-IL')} קמ״ר`,()=>flyToArea(f),()=>toggleSel(id));}
  for(const [k,p] of picked)
    add(p.color,p.name,p.kind==='trail'?`שביל · ${kmTxt(p.km)} ק״מ`:'מקום',()=>fitBox(p.bbox),()=>{picked.delete(k);syncFound();markResults();},
      /Line/.test(p.geometry.type)?()=>openProfile(p.name,p.geometry,p.color):null);
  for(const ref of S.roadSel)
    add(roadColor.get(ref),'כביש '+ref,'כביש',()=>fitBox(roadBox(ref),12),()=>toggleRoad(ref),
      ()=>{const fs=ROADS.features.filter(f=>f.properties.ref===ref);openProfile('כביש '+ref,{type:'MultiLineString',coordinates:fs.flatMap(f=>f.geometry.coordinates)},roadColor.get(ref));});
  const n=mineCount();
  $('mine-n').textContent=n?String(n):'';
  $('mineinfo').textContent=n?(area?`שטח האזורים שנבחרו: כ־${Math.round(area).toLocaleString('he-IL')} קמ״ר`:''):'עוד לא נבחר כלום. חפשו מקום, שביל או כביש, או געו באזור, בכביש או במדינה במפה.';
  if(tabNow()==='mine')$('b-clear').hidden=!n;
}
function clearMine(){
  S.sel.clear();picked.clear();S.roadSel.clear();roadColor.clear();ROADPICK=EMPTY;
  syncFound();renderSel();apply();markResults();
}
