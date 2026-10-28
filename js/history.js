/* history.js — the history timeline: for each period, who ruled, the borders (approximate ones dashed) and the main sites.
   Data: history.json, made by tools/build_history.py. All js/ files share one scope (plain scripts, loaded in order by index.html). */
let HIST=null,histI=0,histPop=null;
const yearTxt=y=>y<0?`${-y} לפנה״ס`:`${y}`;
const spanTxt=p=>p.from<0&&p.to<0?`${-p.from}–${-p.to} לפנה״ס`:p.from<0?`${-p.from} לפנה״ס – ${p.to} לספירה`:`${p.from}–${p.to}`;
function sizeHist(){$('hist').style.bottom=($('panel').offsetHeight+42)+'px';}
function loadHist(){
  if(HIST)return Promise.resolve(HIST);
  return fetch('history.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json();}).then(d=>{
    HIST=d;$('hist-credit').textContent=d.credit;
    const strip=$('hist-strip');strip.textContent='';
    d.periods.forEach((p,i)=>{const b=document.createElement('button');b.setAttribute('role','tab');
      b.innerHTML='<span></span><small></small>';b.querySelector('span').textContent=p.short;b.querySelector('small').textContent=yearTxt(p.from);
      b.onclick=()=>showPeriod(i);strip.append(b);});
    $('hist-range').max=d.periods.length-1;
    return d;});
}
function showPeriod(i){
  const P=HIST.periods;histI=Math.max(0,Math.min(P.length-1,i));const p=P[histI];
  [...$('hist-strip').children].forEach((b,j)=>b.setAttribute('aria-selected',j===histI));
  const on=$('hist-strip').children[histI];on.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
  $('hist-range').value=histI;
  $('hist-name').textContent=p.name;$('hist-years').textContent=spanTxt(p);
  $('hist-ruler').textContent='שלטון: '+p.ruler;$('hist-text').textContent=p.text;
  const lg=$('hist-legend');lg.textContent='';
  p.areas.features.forEach(f=>{const s=document.createElement('span'),c=document.createElement('i');
    c.style.background=f.properties.color;c.style.color=f.properties.color;if(f.properties.approx)c.className='approx';
    s.append(c,f.properties.name);lg.append(s);});
  if(p.line){const s=document.createElement('span'),c=document.createElement('i');c.style.background='#fff2c8';c.style.height='3px';s.append(c,p.line.properties.name);lg.append(s);}
  HIST_A=p.areas;
  HIST_L=fc(p.areas.features.map(f=>({type:'Feature',properties:{name:f.properties.name,color:f.properties.color},geometry:{type:'Point',coordinates:[f.properties.lx,f.properties.ly]}})));
  HIST_S=fc(p.sites.map(s=>({type:'Feature',properties:{n:s.n,t:s.t},geometry:{type:'Point',coordinates:s.c}})));
  HIST_B=p.line?fc([p.line]):EMPTY;
  for(const [id,d] of [['histA',HIST_A],['histL',HIST_L],['histS',HIST_S],['histB',HIST_B]])if(map.getSource(id))map.getSource(id).setData(d);
  if(histPop){histPop.remove();histPop=null;}
  refreshTerrain();
}
function setHist(on){
  if(on&&!HIST){loadHist().then(()=>setHist(true)).catch(()=>{$('b-hist').disabled=true;$('b-hist').title='קובץ ההיסטוריה לא נטען';});return;}
  S.hist=on;press('b-hist',on);$('hist').hidden=!on;
  if(on){sizeHist();showPeriod(histI);
    // the whole land in view, from the south-west as at the start
    if(map.getZoom()>8.2)map.flyTo({...HOME,duration:1400});}
  else if(histPop){histPop.remove();histPop=null;}
  apply();
}
/* a tap on a site opens its note; returns true so the tap does not also drop a height pin */
function histAt(pt){
  if(!S.hist)return false;
  const f=map.queryRenderedFeatures([[pt.x-12,pt.y-12],[pt.x+12,pt.y+12]],{layers:['hist-site','hist-site-names']})[0];
  if(!f)return false;
  if(histPop)histPop.remove();
  const el=document.createElement('div'),b=document.createElement('b'),t=document.createElement('p');
  b.textContent=f.properties.n;t.textContent=f.properties.t;el.append(b,t);
  histPop=new maplibregl.Popup({className:'hist-pop',offset:12,maxWidth:'280px'}).setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);
  return true;
}
$('b-hist').onclick=()=>setHist(!S.hist);
$('hist-x').onclick=()=>setHist(false);
$('hist-fold').onclick=()=>{const f=$('hist').classList.toggle('folded');$('hist-fold').textContent=f?'▴':'▾';$('hist-fold').setAttribute('aria-expanded',!f);$('hist-fold').setAttribute('aria-label',f?'הצגת ההסבר':'הסתרת ההסבר');};
$('hist-prev').onclick=()=>showPeriod(histI-1);
$('hist-next').onclick=()=>showPeriod(histI+1);
$('hist-range').addEventListener('input',e=>showPeriod(+e.target.value));
addEventListener('resize',()=>{if(S.hist)sizeHist();});
// after a data-mode switch the style is rebuilt from HIST_*, so nothing to redo here
