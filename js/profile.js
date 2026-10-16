/* profile.js — elevation profile of a picked trail or road. All js/ files share one scope (plain scripts, loaded in order by index.html). */
/* ---------- elevation profile of a picked trail or road ---------- */
const SLOPE_COL=[[5,'#5fbf4a'],[10,'#e8c33a'],[15,'#f08a3a'],[1e9,'#e0453a']];   // % grade -> colour
const slopeColor=g=>SLOPE_COL.find(([m])=>Math.abs(g)<m)[1];
const PROF={name:'',pts:null,hover:-1,marks:[],markers:[],hoverMarker:null,color:'#ff8a3d'};
// join the pieces of a route into one line: start with the longest, keep adding the nearest piece (turned around if needed)
function chainRoute(g){
  const parts=(g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[]).filter(l=>l.length>1).map(l=>l.slice());
  if(!parts.length)return [];
  const d2=(a,b)=>((a[0]-b[0])*Math.cos(a[1]*Math.PI/180))**2+(a[1]-b[1])**2;
  parts.sort((a,b)=>km({type:'LineString',coordinates:b})-km({type:'LineString',coordinates:a}));
  let line=parts.shift();
  while(parts.length){
    let best=null;
    const A=line[0],B=line[line.length-1],span=d2(A,B);
    parts.forEach((p,i)=>{for(const [end,flip,front] of [[p[0],false,false],[p[p.length-1],true,false],[p[p.length-1],false,true],[p[0],true,true]]){
      // the piece must carry the line further away (so the other lane of a divided road is not added going back)
      const far=front?(flip?p[p.length-1]:p[0]):(flip?p[0]:p[p.length-1]);
      if(d2(front?B:A,far)<=span)continue;
      const d=d2(front?A:B,end);if(!best||d<best.d)best={d,i,flip,front};}});
    if(!best||best.d>(0.03)**2)break;                // nothing within ~3 km: the rest is not part of this line
    let p=parts.splice(best.i,1)[0];if(best.flip)p=p.reverse();
    line=best.front?p.concat(line):line.concat(p);
  }
  return line;
}
function resample(line){
  const segs=[];let tot=0;
  for(let i=1;i<line.length;i++){const d=km({type:'LineString',coordinates:[line[i-1],line[i]]});segs.push(d);tot+=d;}
  const step=Math.max(.03,tot/1500),out=[];let si=0,acc=0;
  for(let s=0;s<=tot+1e-9;s+=step){
    while(si<segs.length-1&&acc+segs[si]<s){acc+=segs[si];si++;}
    const t=segs[si]?Math.min(1,(s-acc)/segs[si]):0,a=line[si],b=line[si+1]||a;
    out.push({d:s,lng:a[0]+(b[0]-a[0])*t,lat:a[1]+(b[1]-a[1])*t});
  }
  return out;
}
async function openProfile(name,geom,color){
  closeProfile();
  const line=chainRoute(geom);if(line.length<2)return;
  PROF.name=name;PROF.color=color;PROF.marks=[];
  const pts=resample(line);
  $('prof').hidden=false;$('profstats').textContent='קורא גבהים…';$('profname').textContent=name;sizeProfile();
  try{
    for(let i=0;i<pts.length;i+=150)await Promise.all(pts.slice(i,i+150).map(p=>elevationAt(p.lng,p.lat).then(z=>p.z=z).catch(()=>p.z=null)));
  }catch(e){}
  const ok=pts.filter(p=>p.z!=null);
  if(ok.length<2){$('profstats').textContent=S.data==='local'?'אין נתוני גובה למסלול הזה (מחוץ לאזור המקומי). נסו במצב "עולמי".':'לא הצלחתי לקרוא גבהים.';return;}
  PROF.pts=ok;computeSlopes();drawProfile();
}
function computeSlopes(){
  const P=PROF.pts,n=P.length;
  // grade over ~100 m around each point (single 30 m steps are too noisy)
  for(let i=0;i<n;i++){let j=i,k=i;while(j>0&&P[i].d-P[j].d<.05)j--;while(k<n-1&&P[k].d-P[i].d<.05)k++;
    P[i].g=P[k].d>P[j].d?(P[k].z-P[j].z)/((P[k].d-P[j].d)*1000)*100:0;}
}
function reverseProfile(){if(!PROF.pts)return;const L=PROF.pts[PROF.pts.length-1].d;PROF.pts=PROF.pts.reverse().map(p=>({...p,d:L-p.d}));
  PROF.marks=PROF.marks.map(i=>PROF.pts.length-1-i);computeSlopes();drawProfile();}
function closeProfile(){$('prof').hidden=true;PROF.pts=null;PROF.marks=[];PROF.markers.forEach(m=>m.remove());PROF.markers=[];
  if(PROF.hoverMarker){PROF.hoverMarker.remove();PROF.hoverMarker=null;}}
function sizeProfile(){$('prof').style.bottom=($('panel').offsetHeight+42)+'px';}
addEventListener('resize',()=>{if(!$('prof').hidden){sizeProfile();drawProfile();}});
function drawProfile(){
  const P=PROF.pts,cv=$('profcv');if(!P)return;
  const dpr=devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;
  const g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
  const L=P[P.length-1].d;let zmin=Infinity,zmax=-Infinity;for(const p of P){zmin=Math.min(zmin,p.z);zmax=Math.max(zmax,p.z);}
  const pad=Math.max(10,(zmax-zmin)*.12);const lo=zmin-pad,hi=zmax+pad;
  const ml=44,mr=8,mt=8,mb=20,X=d=>ml+(W-ml-mr)*d/L,Y=z=>mt+(H-mt-mb)*(1-(z-lo)/(hi-lo));
  PROF.X=X;PROF.ml=ml;PROF.mr=mr;PROF.W=W;PROF.L=L;
  // grid + labels
  g.font='11px system-ui,sans-serif';g.fillStyle='rgba(230,240,235,.65)';g.strokeStyle='rgba(255,255,255,.08)';g.lineWidth=1;
  const zs=niceStep((hi-lo)/4);for(let z=Math.ceil(lo/zs)*zs;z<=hi;z+=zs){const y=Y(z);g.beginPath();g.moveTo(ml,y);g.lineTo(W-mr,y);g.stroke();g.textAlign='right';g.fillText(Math.round(z)+'',ml-6,y+4);}
  const ds=niceStep(L/6);g.textAlign='center';for(let d=0;d<=L+1e-9;d+=ds)g.fillText((ds<1?d.toFixed(1):Math.round(d))+(d===0?'':''),X(d),H-5);
  g.textAlign='left';g.fillText('ק״מ',W-mr-22,H-5);
  // area coloured by grade
  for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];g.fillStyle=slopeColor(b.g)+'cc';
    g.beginPath();g.moveTo(X(a.d),Y(a.z));g.lineTo(X(b.d),Y(b.z));g.lineTo(X(b.d),H-mb);g.lineTo(X(a.d),H-mb);g.closePath();g.fill();}
  g.strokeStyle='#f4f1e8';g.lineWidth=1.6;g.beginPath();P.forEach((p,i)=>i?g.lineTo(X(p.d),Y(p.z)):g.moveTo(X(p.d),Y(p.z)));g.stroke();
  // marked points
  PROF.marks.forEach((i,n)=>{const p=P[i];g.strokeStyle='#ffffff';g.setLineDash([3,3]);g.beginPath();g.moveTo(X(p.d),mt);g.lineTo(X(p.d),H-mb);g.stroke();g.setLineDash([]);
    g.fillStyle='#ff5fa2';g.beginPath();g.arc(X(p.d),Y(p.z),5,0,7);g.fill();g.fillStyle='#fff';g.textAlign='center';g.font='bold 11px system-ui';g.fillText(String(n+1),X(p.d),mt+10);g.font='11px system-ui,sans-serif';});
  // hover
  if(PROF.hover>=0){const p=P[PROF.hover];g.strokeStyle='rgba(255,255,255,.7)';g.beginPath();g.moveTo(X(p.d),mt);g.lineTo(X(p.d),H-mb);g.stroke();
    g.fillStyle='#fff';g.beginPath();g.arc(X(p.d),Y(p.z),4,0,7);g.fill();}
  // summary
  let up=0,down=0,gmax=0;for(let i=1;i<P.length;i++){const dz=P[i].z-P[i-1].z;if(dz>0)up+=dz;else down-=dz;gmax=Math.max(gmax,Math.abs(P[i].g));}
  const parts=[`${kmTxt(L)} ק״מ`,`↑ ${fmt(up)} מ׳`,`↓ ${fmt(down)} מ׳`,`גובה מ־${fmt(zmin)} עד ${fmt(zmax)} מ׳`,`שיפוע מרבי ${Math.round(gmax)}%`];
  const M=PROF.marks.slice().sort((a,b)=>a-b);
  for(let k=1;k<M.length;k++){let u=0,dn=0;for(let i=M[k-1]+1;i<=M[k];i++){const dz=P[i].z-P[i-1].z;if(dz>0)u+=dz;else dn-=dz;}
    parts.push(`${PROF.marks.indexOf(M[k-1])+1}→${PROF.marks.indexOf(M[k])+1}: ${kmTxt(P[M[k]].d-P[M[k-1]].d)} ק״מ, ↑${fmt(u)} ↓${fmt(dn)}`);}
  $('profstats').textContent=parts.join(' · ');
  showHoverText();
}
function niceStep(x){const p=10**Math.floor(Math.log10(x)),f=x/p;return (f<1.5?1:f<3?2:f<7?5:10)*p;}
function showHoverText(){
  const P=PROF.pts,i=PROF.hover;
  $('profhover').textContent=i<0?'הזיזו את האצבע על הגרף; נגיעה מסמנת נקודה על המסלול':`${kmTxt(P[i].d)} ק״מ · ${fmt(P[i].z)} מ׳ · שיפוע ${Math.round(P[i].g)}%`;
}
function profIndex(ev){const r=$('profcv').getBoundingClientRect(),x=ev.clientX-r.left;
  const d=Math.max(0,Math.min(PROF.L,(x-PROF.ml)/(PROF.W-PROF.ml-PROF.mr)*PROF.L));
  let lo=0,hi=PROF.pts.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(PROF.pts[m].d<d)lo=m;else hi=m;}
  return d-PROF.pts[lo].d<PROF.pts[hi].d-d?lo:hi;}
function setHover(i){
  PROF.hover=i;const p=PROF.pts[i];
  if(!PROF.hoverMarker){const el=document.createElement('div');el.className='profdot';PROF.hoverMarker=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map);}
  PROF.hoverMarker.setLngLat([p.lng,p.lat]);drawProfile();
}
function markPoint(i){
  const k=PROF.marks.indexOf(i);
  if(k>=0){PROF.marks.splice(k,1);}else PROF.marks.push(i);
  PROF.markers.forEach(m=>m.remove());
  PROF.markers=PROF.marks.map((j,n)=>{const p=PROF.pts[j],el=document.createElement('div');el.className='pin';
    const b=document.createElement('b');b.textContent=`${n+1} · ${fmt(p.z)} מ׳`;b.style.background='#ff5fa2';
    const s=document.createElement('s');s.style.background='#ff5fa2';const ii=document.createElement('i');ii.style.background='#ff5fa2';el.append(b,ii,s);
    return new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([p.lng,p.lat]).addTo(map);});
  drawProfile();
}
(()=>{const cv=$('profcv');let down=null;
  cv.addEventListener('pointerdown',e=>{if(!PROF.pts)return;down={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);setHover(profIndex(e));});
  cv.addEventListener('pointermove',e=>{if(!PROF.pts)return;if(e.pointerType==='mouse'||down)setHover(profIndex(e));});
  cv.addEventListener('pointerup',e=>{if(!PROF.pts||!down)return;if(Math.hypot(e.clientX-down.x,e.clientY-down.y)<8)markPoint(profIndex(e));down=null;});
  cv.addEventListener('pointerleave',()=>{if(!down&&PROF.pts){PROF.hover=-1;if(PROF.hoverMarker){PROF.hoverMarker.remove();PROF.hoverMarker=null;}drawProfile();}});
})();
$('prof-x').onclick=closeProfile;
$('prof-rev').onclick=reverseProfile;
$('prof-clear').onclick=()=>{PROF.marks=[];PROF.markers.forEach(m=>m.remove());PROF.markers=[];drawProfile();};
