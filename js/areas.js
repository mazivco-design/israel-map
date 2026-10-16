/* areas.js — regions, landforms and countries: loading, picking, highlighting. All js/ files share one scope (plain scripts, loaded in order by index.html). */
/* ---------- regions and countries: pick several at once; picked ones are highlighted and the rest dimmed ---------- */
const AREAS=new Map();
function loadAreas(url,assign,btn,what){
  return fetch(url).then(r=>r.json()).then(d=>{assign(d.features);d.features.forEach(f=>AREAS.set(f.properties.id,f));
    const set=()=>{if(url!=='countries.geojson'){REG=[...REG_SUB,...REG_BIG];map.getSource('regions').setData(fc(REG));map.getSource('regionLabels').setData(labelsOf(REG));}
      else{map.getSource('countries').setData(fc(CTR));map.getSource('countryLabels').setData(labelsOf(CTR));}refreshTerrain();};
    map.isStyleLoaded()?set():map.once('load',set);fillPicker();})
   .catch(()=>{$(btn).disabled=true;$(btn).title=`קובץ ה${what} לא נטען`;});
}
loadAreas('regions.geojson',f=>REG_BIG=f,'b-regions','אזורים');
// small regions; the same file also holds the points of interest
loadAreas('subregions.geojson',f=>{REG_SUB=f.filter(x=>x.geometry.type!=='Point');POIS=fc(f.filter(x=>x.geometry.type==='Point'));
  const put=()=>map.getSource('pois')&&map.getSource('pois').setData(POIS);map.isStyleLoaded()?put():map.once('load',put);},'b-regions','אזורים');
loadAreas('countries.geojson',f=>CTR=f,'b-countries','מדינות');
const byName=(a,b)=>a.properties.name.localeCompare(b.properties.name,'he');
function fillPicker(){
  const sel=$('addsel');sel.length=1;
  for(const [on,list,label] of [[S.regions,REG_BIG,'אזורים בישראל'],[S.land,REG_SUB,'נוף: מכתשים, בקעות והרים'],[S.countries,CTR,'מדינות']]){
    if(!on||!list.length)continue;
    const g=document.createElement('optgroup');g.label=label;
    [...list].sort(byName).forEach(f=>{if(S.sel.has(f.properties.id))return;const o=document.createElement('option');o.value=f.properties.id;o.textContent=f.properties.name;g.append(o);});
    sel.append(g);
  }
}
function renderSel(){
  $('selctl').hidden=!(S.regions||S.land||S.countries);
  fillPicker();renderMine();
}
function flyToArea(f){
  const [w,s,e,n]=f.properties.bbox;
  if(e-w>180)map.flyTo({center:[f.properties.lx,f.properties.ly],zoom:2.5,pitch:30,duration:1800});
  else map.fitBounds([[w,s],[e,n]],{padding:{top:140,bottom:200,left:50,right:50},pitch:45,duration:1800,maxZoom:11});
}
function toggleSel(id,fly){
  if(!id)return;
  if(S.sel.has(id))S.sel.delete(id);else{S.sel.add(id);if(fly)flyToArea(AREAS.get(id));showTab('mine');}
  renderSel();apply();
}
$('addsel').addEventListener('change',e=>{toggleSel(e.target.value,true);e.target.value='';});
const areaKind=id=>id.startsWith('c_')?'countries':id.startsWith('s_')?'land':'regions';
function showAreas(kind,on){
  S[kind]=on;press({regions:'b-regions',land:'b-land',countries:'b-countries'}[kind],on);
  if(!on)for(const id of [...S.sel])if(areaKind(id)===kind)S.sel.delete(id);
  renderSel();apply();
}
$('b-regions').onclick=()=>showAreas('regions',!S.regions);
$('b-countries').onclick=()=>showAreas('countries',!S.countries);
$('b-land').onclick=()=>showAreas('land',!S.land);
function inRing(pt,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))c=!c;}return c;}
function inPoly(pt,g){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  return polys.some(p=>inRing(pt,p[0])&&!p.slice(1).some(h=>inRing(pt,h)));}
function areaAt(lngLat){
  const pt=[lngLat.lng,lngLat.lat];
  const f=(S.land&&REG_SUB.find(f=>inPoly(pt,f.geometry)))||(S.regions&&REG_BIG.find(f=>inPoly(pt,f.geometry)))||(S.countries&&CTR.find(f=>inPoly(pt,f.geometry)));
  return f?f.properties.id:'';
}

/* marked hiking routes come from Waymarked Trails. The layer is only added while trails are on,
   and removed for good if its server refuses the tiles, so a failure there never affects the rest of the map. */
let markedFailed=false;
const MARKED={type:'raster',tiles:['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],tileSize:512,maxzoom:17,   // 512: each tile drawn twice as big, so the marked lines stay bold when zoomed in
  attribution:'מסלולים מסומנים: <a href="https://hiking.waymarkedtrails.org" target="_blank">Waymarked Trails</a>'};
function setMarked(on){
  if(on&&!markedFailed&&!map.getSource('marked')){map.addSource('marked',MARKED);map.addLayer({id:'trails-marked',type:'raster',source:'marked',minzoom:8,paint:{'raster-opacity':.9}},'found-line');}
  if(!on&&map.getLayer('trails-marked')){map.removeLayer('trails-marked');map.removeSource('marked');}
}
