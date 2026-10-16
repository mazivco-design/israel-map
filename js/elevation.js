/* elevation.js — reading heights from the terrain tiles; survey pins. All js/ files share one scope (plain scripts, loaded in order by index.html). */
/* ---------- exact elevation read from the terrain tiles of the current data mode ---------- */
const tileCache=new Map();
function tilePixels(url){
  if(!tileCache.has(url)){
    tileCache.set(url,fetch(url)
      .then(r=>{if(!r.ok)throw new Error(r.status);return r.blob();})
      .then(b=>createImageBitmap(b))
      .then(img=>{const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);return g.getImageData(0,0,256,256).data;})
      .catch(e=>{tileCache.delete(url);throw e;}));
  }
  return tileCache.get(url);
}
async function elevationAt(lng,lat){
  const M=SRC[S.data],b=M.bounds;
  if(b&&(lng<b[0]||lng>b[2]||lat<b[1]||lat>b[3]))throw new Error('outside');
  const z=M.elevZ||M.demMax,n=2**z,r=Math.PI/180;
  const fx=(lng+180)/360*n*256-.5;
  const fy=(1-Math.log(Math.tan(lat*r)+1/Math.cos(lat*r))/Math.PI)/2*n*256-.5;
  const x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;
  const val=async(px,py)=>{const d=await tilePixels(M.dem.replace('{z}',z).replace('{x}',Math.floor(px/256)).replace('{y}',Math.floor(py/256)));
    const i=(((py%256)+256)%256*256+((px%256)+256)%256)*4;return d[i]*256+d[i+1]+d[i+2]/256-32768;};
  const [a,bb,c,d]=await Promise.all([val(x0,y0),val(x0+1,y0),val(x0,y0+1),val(x0+1,y0+1)]);
  return (a*(1-tx)+bb*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty;
}

/* ---------- survey pins ---------- */
const pins=[];
const fmt=n=>Math.round(n).toLocaleString('he-IL');
function distKm(a,b){const R=6371,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lng-a.lng)*r;const h=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const hText=P=>P.z==null?'…':fmt(P.z)+' מ׳';
function render(){
  const rows=$('rows');rows.textContent='';
  pins.forEach((P,i)=>{
    P.label.textContent=`${i+1} · ${hText(P)}`;
    const li=document.createElement('li'),prev=pins[i-1];
    li.innerHTML='<span class="n"></span><span class="h"></span><span class="d"></span><button></button>';
    li.querySelector('.n').textContent=i+1;
    li.querySelector('.h').textContent=hText(P);
    if(prev&&P.z!=null&&prev.z!=null){const dz=P.z-prev.z;li.querySelector('.d').textContent=`${dz>=0?'+':'−'}${fmt(Math.abs(dz))} מ׳ · ${distKm(prev,P).toFixed(1)} ק״מ`;}
    const b=li.querySelector('button');b.textContent='×';b.setAttribute('aria-label',`מחיקת נקודה ${i+1}`);b.onclick=()=>removePin(i);
    rows.appendChild(li);
  });
  if(tabNow()==='pins')$('b-clear').hidden=!pins.length;
  const P=pins[pins.length-1];
  if(!P){$('last').textContent='—';$('lastco').textContent='געו במפה כדי לסמן נקודה';$('lastnote').textContent='';return;}
  $('last').textContent=hText(P);
  $('lastco').textContent=`${P.lat.toFixed(5)}°N  ${P.lng.toFixed(5)}°E`;
  $('lastnote').textContent=P.err==='outside'?'הנקודה מחוץ לאזור המקומי. לקריאת גובה כאן עברו למצב "עולמי".':P.err?'לא הצלחתי לקרוא את הגובה. בדקו את החיבור לאינטרנט.':P.z==null?'קורא גובה…':SRC[S.data].note;
}
function addPin(lngLat){
  const el=document.createElement('div');el.className='pin';
  const label=document.createElement('b');el.append(label,document.createElement('i'),document.createElement('s'));
  const marker=new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat(lngLat).addTo(map);
  const P={lng:lngLat.lng,lat:lngLat.lat,z:null,marker,label,err:false};
  pins.push(P);render();readPin(P);
}
function readPin(P){
  elevationAt(P.lng,P.lat).then(z=>{P.z=z;render();}).catch(e=>{P.err=e&&e.message==='outside'?'outside':true;render();});
}
function removePin(i){pins.splice(i,1)[0].marker.remove();render();}
$('b-clear').onclick=()=>{if(tabNow()==='mine'){clearMine();return;}while(pins.length)removePin(pins.length-1);};
// tap a road (its number or the line) to add it to the picked roads, tap it again to drop it
function roadAt(pt){
  if(!S.roads)return null;
  const box=[[pt.x-10,pt.y-10],[pt.x+10,pt.y+10]];
  const f=map.queryRenderedFeatures(box,{layers:['road-shields','road-pick-hit']}).find(f=>f.properties.ref);
  return f?String(f.properties.ref):null;
}
map.on('click',e=>{if(!results.hidden){results.hidden=true;return;}
  const ref=roadAt(e.point);
  if(ref){toggleRoad(ref,false);return;}
  if(S.regions||S.land||S.countries){toggleSel(areaAt(e.lngLat),false);return;}
  addPin(e.lngLat);showTab('pins');});
