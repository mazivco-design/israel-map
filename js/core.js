/* core.js — map style, state (S), apply(), controls, data modes, roads and tracks layers. All js/ files share one scope (plain scripts, loaded in order by index.html). */
const $=id=>document.getElementById(id);
// iPad browsers ignore user-scalable=no: stop the page pinch gesture directly, so only the map zooms and the panels keep their size
['gesturestart','gesturechange','gestureend'].forEach(t=>document.addEventListener(t,e=>e.preventDefault(),{passive:false}));
document.addEventListener('touchmove',e=>{if(e.touches.length>1&&!e.target.closest('#map'))e.preventDefault();},{passive:false});
if(!window.maplibregl){document.body.insertAdjacentHTML('beforeend','<p style="position:fixed;inset:0;display:grid;place-items:center;color:#9db0a8">לא הצלחתי לטעון את ספריית המפה. בדקו את החיבור לאינטרנט ורעננו.</p>');throw new Error('maplibre missing');}

const BASE=location.href.replace(/[?#].*$/,'').replace(/[^/]*$/,'');
const CREDIT_OSM='© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · © OpenMapTiles';
const CREDIT_COP='גובה: Copernicus DEM GLO-30 © DLR e.V., © Airbus Defence and Space GmbH, provided under COPERNICUS by the EU and ESA';
/* Two data modes. "local": everything is served from this site (map tiles built by .github/workflows/build-map.yml,
   elevation by build-terrain.yml), covering the Israel area. "global": OpenFreeMap + AWS Terrarium, the whole world. */
const LOCAL_BOUNDS=[34.0,29.3,36.2,33.6];
const SRC={
  local:{vector:{type:'vector',url:'pmtiles://'+BASE+'map/israel.pmtiles',attribution:CREDIT_OSM+' · '+CREDIT_COP},
    glyphs:BASE+'fonts/{fontstack}/{range}.pbf',
    dem:BASE+'terrain/{z}/{x}/{y}.webp',demMax:12,bounds:LOCAL_BOUNDS,
    note:'מנתוני Copernicus (רשת של כ־30 מ׳, דיוק טיפוסי של כמה מטרים)'},
  global:{vector:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:CREDIT_OSM+' · <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · Terrain: Mapzen / AWS Open Data'},
    glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    dem:'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',demMax:15,elevZ:14,bounds:null,
    note:'מאריחי Terrarium (מבוסס SRTM, דיוק טיפוסי 5–15 מ׳)'}
};
if(window.pmtiles){const p=new pmtiles.Protocol();maplibregl.addProtocol('pmtiles',p.tile);}
const FONT=['Noto Sans Regular'], FONTB=['Noto Sans Bold'];
const NAME=['coalesce',['get','name:he'],['get','name']];

// hypsometric ramp (meters) shared by the map and the legend
const STOPS=[[-430,'#5c8054'],[-200,'#76965c'],[0,'#588a5c'],[150,'#8caa68'],[400,'#cdc482'],[700,'#c6a066'],[1000,'#aa764e'],[1400,'#8c6048'],[1900,'#a08c80'],[2400,'#cdc6c0'],[2800,'#f8f7f4']];
$('ramp').style.background='linear-gradient(to right,'+STOPS.map(([z,c])=>`${c} ${((z+430)/3230*100).toFixed(1)}%`).join(',')+')';

// libraries are kept in lib/ (MapLibre GL 5.9.0, mapbox-gl-rtl-text 0.3.0, PMTiles 4.4.1, maplibre-contour 0.1.0) so the site does not depend on a CDN
maplibregl.setRTLTextPlugin(new URL('lib/mapbox-gl-rtl-text.js',location.href).href,true).catch(()=>{});

const small=innerWidth<600;
const HOME={center:[35.05,31.45],zoom:small?6.6:7.25,pitch:55,bearing:60};   // looking north-east, from over the sea off Gaza and Sinai
const EMPTY={type:'FeatureCollection',features:[]};
const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};

/* ---------- everything the viewer has switched on lives here; the style is rebuilt from it ---------- */
const S={data:store.get('dataMode')==='global'?'global':'local',color:'hyp',ex:2,labels:true,roads:false,trails:false,tracks:false,contours:false,contourHi:null,net:true,otm:false,otmOp:.6,roadSel:new Set(),satellite:false,land:false,stype:'place',sun:false,sunI:0,sunDate:'',regions:false,countries:false,sel:new Set()};
let ROADPICK=EMPTY,ROADS=null;   // picked roads, whole (from roads.geojson, made by tools/build_roads.py)
let REG=[],REG_BIG=[],REG_SUB=[],POIS=EMPTY,CTR=[],FOUND=EMPTY;   // REG = small regions first (they win a click), then the large ones
/* contour lines, worked out in the browser (maplibre-contour, in a web worker) from the same elevation tiles the 3D terrain uses.
   Thresholds per zoom: [line every N m, thicker labelled line every M m]. One generator per data mode, made on first use. */
const CONTOUR_STEPS={8:[100,500],10:[50,200],12:[20,100],13:[10,50]};
const DEMSRC={};
function contourTiles(){
  if(!window.mlcontour)return null;
  const M=SRC[S.data];
  if(!DEMSRC[S.data]){DEMSRC[S.data]=new mlcontour.DemSource({url:M.dem,encoding:'terrarium',maxzoom:M.demMax,worker:true,cacheSize:100,timeoutMs:15000});
    DEMSRC[S.data].setupMaplibre(maplibregl);}
  return DEMSRC[S.data].contourProtocolUrl({thresholds:CONTOUR_STEPS,elevationKey:'ele',levelKey:'level',contourLayer:'contours',buffer:1});
}
/* the one height the viewer picked to stand out: a second set of lines every |H| m, filtered to H itself */
function contourHiTiles(){
  if(!window.mlcontour)return null;
  contourTiles();
  const h=Math.abs(S.contourHi||1000)||1000,th={};
  for(let z=5;z<=15;z++)th[z]=[h];
  return DEMSRC[S.data].contourProtocolUrl({thresholds:th,elevationKey:'ele',levelKey:'level',contourLayer:'contours',buffer:1});
}
const fc=f=>({type:'FeatureCollection',features:f});
const labelsOf=list=>fc(list.map(f=>({type:'Feature',properties:{name:f.properties.name,small:!!f.properties.kind},geometry:{type:'Point',coordinates:[f.properties.lx,f.properties.ly]}})));

// OpenTopoMap, a topographic map made from other elevation data (SRTM): laid over the map to check the contour lines against it
const OTM={type:'raster',tiles:['a','b','c'].map(c=>`https://${c}.tile.opentopomap.org/{z}/{x}/{y}.png`),tileSize:256,maxzoom:17,
  attribution:'השוואה: © <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA), SRTM'};
const SAT={type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,
  attribution:'לוויין: <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'};
// normal relief shading: soft light from several directions. In sun mode it is replaced by one light from the sun.
const SHADE_MULTI={'hillshade-method':'multidirectional','hillshade-illumination-anchor':'viewport',
  'hillshade-highlight-color':['rgba(255,255,255,0.32)','rgba(255,250,240,0.18)','rgba(255,255,255,0.12)','rgba(255,255,255,0.12)'],
  'hillshade-shadow-color':['rgba(0,0,0,0.55)','rgba(0,0,0,0.35)','rgba(0,0,0,0.25)','rgba(0,0,0,0.25)'],
  'hillshade-illumination-direction':[315,270,0,45],'hillshade-illumination-altitude':[35,40,40,45],
  // no fades: a fade between the 4-light and 1-light values is not possible
  'hillshade-highlight-color-transition':{duration:0},'hillshade-shadow-color-transition':{duration:0}};
// difficulty of a dirt road from its OpenStreetMap tags (tracktype grade1-5, 4wd_only, smoothness)
const TRACK_DIFF=['case',
  ['any',['==',['get','4wd_only'],'yes'],['in',['coalesce',['get','tracktype'],''],['literal',['grade4','grade5']]],
    ['in',['coalesce',['get','smoothness'],''],['literal',['very_bad','horrible','very_horrible','impassable']]]],'hard',
  ['any',['==',['get','tracktype'],'grade3'],['==',['get','smoothness'],'bad']],'mid',
  ['any',['in',['coalesce',['get','tracktype'],''],['literal',['grade1','grade2']]],['in',['coalesce',['get','smoothness'],''],['literal',['excellent','good','intermediate']]]],'easy',
  'unknown'];
function buildStyle(){
  const M=SRC[S.data];
  const dem={type:'raster-dem',tiles:[M.dem],encoding:'terrarium',tileSize:256,maxzoom:M.demMax};
  if(M.bounds)dem.bounds=M.bounds;
  const hide={visibility:'none'};
  return {
    version:8,glyphs:M.glyphs,
    sources:{omt:M.vector,dem:{...dem},demShade:{...dem},
      regions:{type:'geojson',data:fc(REG)},regionLabels:{type:'geojson',data:labelsOf(REG)},
      countries:{type:'geojson',data:fc(CTR)},countryLabels:{type:'geojson',data:labelsOf(CTR)},
      found:{type:'geojson',data:FOUND},roadpick:{type:'geojson',data:ROADPICK},tracks:{type:'vector',url:'pmtiles://'+BASE+'map/tracks.pmtiles'},pois:{type:'geojson',data:POIS},
      // satellite imagery streams from Esri, so it exists in global mode only
      ...(S.data==='global'?{sat:SAT}:{}),otm:OTM,
      ...(window.mlcontour?{contours:{type:'vector',tiles:[contourTiles()],maxzoom:15,...(M.bounds?{bounds:M.bounds}:{})},
        contourHi:{type:'vector',tiles:[contourHiTiles()],maxzoom:15,...(M.bounds?{bounds:M.bounds}:{})}}:{})},
    sky:{'sky-color':'#0f1716','horizon-color':'#26302d','fog-color':'#0f1716','sky-horizon-blend':.6,'horizon-fog-blend':.6,'fog-ground-blend':.75,'atmosphere-blend':0},
    terrain:{source:'dem',exaggeration:S.ex},
    layers:[
      {id:'bg',type:'background',paint:{'background-color':'#4a4d4f'}},
      {id:'relief',type:'color-relief',source:'demShade',paint:{'color-relief-opacity':1,'color-relief-color':['interpolate',['linear'],['elevation'],...STOPS.flat()]}},
      ...(S.data==='global'?[{id:'satellite',type:'raster',source:'sat',layout:hide,paint:{'raster-fade-duration':150}}]:[]),
      {id:'shade',type:'hillshade',source:'demShade',paint:{...SHADE_MULTI}},
      {id:'water',type:'fill',source:'omt','source-layer':'water',paint:{'fill-color':'#2e5c7c'}},
      {id:'otm',type:'raster',source:'otm',layout:hide,paint:{'raster-opacity':S.otmOp,'raster-fade-duration':150}},
      // contour lines: thin every step, thicker (level 1) on the round heights, which also get their number
      ...(window.mlcontour?[{id:'contours',type:'line',source:'contours','source-layer':'contours',minzoom:8,layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#f6eedc','line-opacity':.5,'line-width':['interpolate',['linear'],['zoom'],8,.5,14,1]}},
        {id:'contour-hi',type:'line',source:'contourHi','source-layer':'contours',minzoom:5,layout:{...hide,'line-join':'round'},filter:['==',['get','ele'],S.contourHi??-99999],
          paint:{'line-color':'#ffd23f','line-width':['interpolate',['linear'],['zoom'],6,1.6,12,3,15,4.5]}}]:[]),
      {id:'river',type:'line',source:'omt','source-layer':'waterway',minzoom:9,filter:['in',['get','class'],['literal',['river','stream']]],
        paint:{'line-color':'#4f8fb3','line-width':['interpolate',['linear'],['zoom'],9,.4,14,1.6],'line-opacity':.7}},
      {id:'border',type:'line',source:'omt','source-layer':'boundary',filter:['==',['get','admin_level'],2],
        paint:{'line-color':'#e8efe9','line-opacity':.35,'line-width':1,'line-dasharray':[3,2]}},
      {id:'country-dim',type:'fill',source:'countries',layout:hide,paint:{'fill-color':'#05080a','fill-opacity':0}},
      {id:'country-sel',type:'fill',source:'countries',layout:hide,paint:{'fill-color':'#f3c45a','fill-opacity':.3}},
      {id:'country-lines',type:'line',source:'countries',layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#e8efe9','line-opacity':.6,'line-width':['interpolate',['linear'],['zoom'],2,.5,8,1.5]}},
      {id:'country-sel-line',type:'line',source:'countries',layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#ffd166','line-width':['interpolate',['linear'],['zoom'],2,1.5,8,4]}},
      {id:'region-dim',type:'fill',source:'regions',layout:hide,paint:{'fill-color':'#05080a','fill-opacity':0}},
      {id:'region-sel',type:'fill',source:'regions',layout:hide,paint:{'fill-color':'#f3c45a','fill-opacity':.32}},
      {id:'region-lines',type:'line',source:'regions',filter:['!',['has','kind']],layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#f3d48a','line-opacity':.75,'line-width':['interpolate',['linear'],['zoom'],6,.8,11,2],'line-dasharray':[4,2]}},
      {id:'region-sel-line',type:'line',source:'regions',layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#ffd166','line-width':['interpolate',['linear'],['zoom'],6,2.5,11,4.5]}},
      // small regions (craters, valleys, single mountains) traced from the terrain by tools/build_subregions.py
      {id:'sub-lines',type:'line',source:'regions',filter:['has','kind'],minzoom:7,layout:{...hide,'line-join':'round'},
        paint:{'line-color':'#8fd8ff','line-opacity':.85,'line-width':['interpolate',['linear'],['zoom'],7,1,12,2.5]}},
      {id:'roads-major',type:'line',source:'omt','source-layer':'transportation',minzoom:8,
        filter:['in',['get','class'],['literal',['motorway','trunk','primary']]],
        paint:{'line-color':'#f2e6c9','line-opacity':['interpolate',['linear'],['zoom'],8,.18,12,.45],'line-width':['interpolate',['linear'],['zoom'],8,.5,14,2.5]}},
      {id:'roads-minor',type:'line',source:'omt','source-layer':'transportation',minzoom:11,
        filter:['in',['get','class'],['literal',['secondary','tertiary','minor']]],
        paint:{'line-color':'#f2e6c9','line-opacity':.28,'line-width':['interpolate',['linear'],['zoom'],11,.3,15,1.4]}},
      // dirt roads coloured by how hard they are (map/tracks.pmtiles, built from OpenStreetMap by build-tracks.yml)
      {id:'tracks-4x4',type:'line',source:'tracks','source-layer':'tracks',minzoom:9,layout:{...hide,'line-join':'round','line-cap':'round'},
        paint:{'line-color':['match',TRACK_DIFF,'hard','#ff4d4d','mid','#ffc23a','easy','#7ddc5a','#d8c9a8'],
          'line-opacity':['match',TRACK_DIFF,'unknown',.7,.95],
          'line-width':['interpolate',['linear'],['zoom'],9,.8,12,1.8,15,4]}},
      // "roads" layer: stronger road lines by class, with route numbers in small shields (see makeShield)
      {id:'roads-hl-case',type:'line',source:'omt','source-layer':'transportation',minzoom:6,layout:{...hide,'line-join':'round','line-cap':'round'},
        filter:['in',['get','class'],['literal',['motorway','trunk','primary','secondary','tertiary']]],
        paint:{'line-color':'#1a1410','line-opacity':.55,'line-width':['interpolate',['linear'],['zoom'],6,['match',['get','class'],['motorway','trunk'],2.2,1.2],12,['match',['get','class'],['motorway','trunk'],6,'primary',5,3.5],15,['match',['get','class'],['motorway','trunk'],10,8]]}},
      {id:'roads-hl',type:'line',source:'omt','source-layer':'transportation',minzoom:6,layout:{...hide,'line-join':'round','line-cap':'round'},
        filter:['in',['get','class'],['literal',['motorway','trunk','primary','secondary','tertiary']]],
        paint:{'line-color':['match',['get','class'],'motorway','#e8564b','trunk','#f08a4b','primary','#f5c04a','secondary','#f2ecd0','#d8d2b8'],
          'line-width':['interpolate',['linear'],['zoom'],6,['match',['get','class'],['motorway','trunk'],1.2,.6],12,['match',['get','class'],['motorway','trunk'],4,'primary',3.2,2],15,['match',['get','class'],['motorway','trunk'],7,5.5]]}},
      {id:'trails-paths',type:'line',source:'omt','source-layer':'transportation',minzoom:10,
        filter:['in',['get','class'],['literal',['path','track']]],layout:{...hide,'line-join':'round'},
        paint:{'line-color':['match',['get','class'],'track','#e8d6a8','#ffd27a'],'line-opacity':.85,
          'line-width':['interpolate',['linear'],['zoom'],10,.8,13,2,16,4.5],'line-dasharray':[2,1.5]}},
      ...(window.mlcontour?[{id:'contour-labels',type:'symbol',source:'contours','source-layer':'contours',minzoom:9.5,filter:['>',['get','level'],0],
        layout:{...hide,'symbol-placement':'line','symbol-spacing':300,'text-field':['to-string',['get','ele']],'text-font':FONT,'text-size':10,'text-max-angle':25},
        paint:{'text-color':'#fff6e0','text-halo-color':'#2a2016','text-halo-width':1.3}},
        {id:'contour-hi-labels',type:'symbol',source:'contourHi','source-layer':'contours',minzoom:8,filter:['==',['get','ele'],S.contourHi??-99999],
          layout:{...hide,'symbol-placement':'line','symbol-spacing':350,'text-field':['concat',['to-string',['get','ele']],' מ׳'],'text-font':FONTB,'text-size':12,'text-max-angle':25},
          paint:{'text-color':'#ffe680','text-halo-color':'#231a00','text-halo-width':1.6}}]:[]),
      {id:'found-line',type:'line',source:'found',filter:['!=',['geometry-type'],'Point'],layout:{'line-join':'round','line-cap':'round'},
        paint:{'line-color':['coalesce',['get','color'],'#ff8a3d'],'line-width':['interpolate',['linear'],['zoom'],6,2.5,13,5],'line-blur':.4}},
      {id:'found-point',type:'circle',source:'found',filter:['==',['geometry-type'],'Point'],
        paint:{'circle-radius':7,'circle-color':['coalesce',['get','color'],'#ff8a3d'],'circle-stroke-color':'#1b0c05','circle-stroke-width':2}},
      // a picked road (by its number): an invisible wide line to catch taps, and the bright highlight itself
      {id:'road-pick-hit',type:'line',source:'omt','source-layer':'transportation_name',minzoom:6,layout:{...hide},
        filter:['has','ref'],paint:{'line-color':'#000','line-opacity':.01,'line-width':14}},
      {id:'road-pick-case',type:'line',source:'roadpick',layout:{...hide,'line-join':'round','line-cap':'round'},paint:{'line-color':'#1b0c05','line-width':['interpolate',['linear'],['zoom'],6,4,12,9,15,13]}},
      {id:'road-pick',type:'line',source:'roadpick',layout:{...hide,'line-join':'round','line-cap':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],6,2.2,12,5.5,15,8.5]}},
      {id:'road-shields',type:'symbol',source:'omt','source-layer':'transportation_name',layout:{...hide,
          'symbol-placement':'line','symbol-spacing':['interpolate',['linear'],['zoom'],8,250,12,450,15,1200],
          'text-field':['get','ref'],'text-font':FONTB,'text-size':11,
          'icon-image':['match',['get','class'],'motorway','shield-motorway','trunk','shield-trunk','primary','shield-primary','shield-minor'],
          'icon-text-fit':'both','icon-text-fit-padding':[1,4,1,4],
          'icon-rotation-alignment':'viewport','text-rotation-alignment':'viewport','text-pitch-alignment':'viewport','icon-pitch-alignment':'viewport'},
        filter:['all',['has','ref'],['<=',['length',['to-string',['get','ref']]],6],
          ['>=',['zoom'],['match',['get','class'],['motorway','trunk'],6.5,'primary',9,['secondary','tertiary'],10.5,99]]],
        paint:{'text-color':['match',['get','class'],['motorway','trunk'],'#ffffff','#1b1607']}},
      {id:'water-name',type:'symbol',source:'omt','source-layer':'water_name',
        layout:{'text-field':NAME,'text-font':FONT,'text-size':13},
        paint:{'text-color':'#bfe0f2','text-halo-color':'#0b1418','text-halo-width':1.4}},
      {id:'peaks',type:'symbol',source:'omt','source-layer':'mountain_peak',minzoom:8,
        filter:['<=',['coalesce',['get','rank'],99],['step',['zoom'],1,9,3,11,6,12,99]],
        layout:{'text-field':['case',['has','ele'],['format',NAME,{},'\n',{},['concat',['to-string',['get','ele']],' מ׳'],{'font-scale':.82}],NAME],
          'text-font':FONT,'text-size':12,'text-anchor':'bottom','text-offset':[0,-.3],'text-max-width':8},
        paint:{'text-color':'#ffe7b0','text-halo-color':'#14110b','text-halo-width':1.4}},
      {id:'places-minor',type:'symbol',source:'omt','source-layer':'place',minzoom:10,
        filter:['in',['get','class'],['literal',['village','suburb','hamlet','neighbourhood','locality']]],
        layout:{'text-field':NAME,'text-font':FONT,'text-size':['interpolate',['linear'],['zoom'],10,11,14,13],'text-max-width':8},
        paint:{'text-color':'#d9e0da','text-halo-color':'#0f1716','text-halo-width':1.3}},
      {id:'places-town',type:'symbol',source:'omt','source-layer':'place',minzoom:7,filter:['==',['get','class'],'town'],
        layout:{'text-field':NAME,'text-font':FONT,'text-size':['interpolate',['linear'],['zoom'],7,11,12,15],'text-max-width':8},
        paint:{'text-color':'#eef2ee','text-halo-color':'#0f1716','text-halo-width':1.5}},
      {id:'places-city',type:'symbol',source:'omt','source-layer':'place',filter:['==',['get','class'],'city'],
        layout:{'text-field':NAME,'text-font':FONTB,'text-size':['interpolate',['linear'],['zoom'],5,12,10,18],'text-max-width':8},
        paint:{'text-color':'#ffffff','text-halo-color':'#0f1716','text-halo-width':1.8}},
      {id:'country-names',type:'symbol',source:'countryLabels',maxzoom:7,
        layout:{...hide,'text-field':['get','name'],'text-font':FONTB,'text-size':['interpolate',['linear'],['zoom'],2,10,6,15],'text-max-width':7},
        paint:{'text-color':'#e8efe9','text-halo-color':'#0f1716','text-halo-width':1.6}},
      {id:'sub-names',type:'symbol',source:'regionLabels',minzoom:8.5,filter:['get','small'],
        layout:{...hide,'text-field':['get','name'],'text-font':FONTB,'text-size':['interpolate',['linear'],['zoom'],8.5,12,13,16]},
        paint:{'text-color':'#bfe9ff','text-halo-color':'#0b1418','text-halo-width':1.6}},
      // points of interest too small to outline (a lookout, a hill)
      {id:'poi-dot',type:'circle',source:'pois',minzoom:9,paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,3.5,14,6],'circle-color':'#ff8fc4','circle-stroke-color':'#1b0c12','circle-stroke-width':1.5}},
      {id:'poi-names',type:'symbol',source:'pois',minzoom:10,
        layout:{'text-field':['get','name'],'text-font':FONTB,'text-size':13,'text-anchor':'bottom','text-offset':[0,-.6]},
        paint:{'text-color':'#ffd3e8','text-halo-color':'#1b0c12','text-halo-width':1.5}},
      {id:'region-names',type:'symbol',source:'regionLabels',maxzoom:11,filter:['!',['get','small']],
        layout:{...hide,'text-field':['get','name'],'text-font':FONTB,'text-size':['interpolate',['linear'],['zoom'],6,12,10,17],'text-letter-spacing':.12},
        paint:{'text-color':'#f3d48a','text-halo-color':'#15120a','text-halo-width':1.6,'text-opacity':.95}}
    ]
  };
}
const LABEL_LAYERS=['water-name','peaks','places-minor','places-town','places-city','poi-dot','poi-names'];
const ROAD_LAYERS=['roads-hl-case','roads-hl','road-shields','road-pick-hit','road-pick-case','road-pick'];
const REGION_LAYERS=['region-dim','region-lines','region-names'];
const LAND_LAYERS=['sub-lines','sub-names'];
const COUNTRY_LAYERS=['country-dim','country-sel','country-lines','country-sel-line','country-names'];

const map=new maplibregl.Map({container:'map',style:buildStyle(),...HOME,maxPitch:80,attributionControl:false});
map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
// start with the credits folded into the (i) button
map.once('load',()=>{const c=map.getContainer().querySelector('.maplibregl-ctrl-attrib');if(c)c.classList.remove('maplibregl-compact-show');});

// layers draped over the 3D terrain are cached as textures; clear that cache after a change so it shows
function refreshTerrain(){try{map.terrain&&map.terrain.sourceCache.freeRtt();}catch(e){}map.triggerRepaint();}
/* push S onto the current style: visibility, selection filters, colors */
function apply(){
  if(!map.getLayer('bg'))return;
  const vis=(id,on)=>{if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');};
  const sat=S.satellite&&S.data==='global';
  vis('satellite',sat);
  vis('relief',S.color==='hyp'&&!sat);
  $('legend').hidden=S.color!=='hyp'||sat;
  map.setPaintProperty('bg','background-color',S.color==='hyp'?'#4a4d4f':'#4d5053');
  LABEL_LAYERS.forEach(id=>vis(id,S.labels));
  vis('trails-paths',S.trails);
  ROAD_LAYERS.forEach(id=>vis(id,S.roads));
  vis('tracks-4x4',S.tracks);
  vis('contours',S.contours);vis('contour-labels',S.contours);
  const hi=S.contours&&S.contourHi!==null;vis('contour-hi',hi);vis('contour-hi-labels',hi);
  vis('roads-major',S.net);vis('roads-minor',S.net);
  vis('otm',S.otm);if(map.getLayer('otm'))map.setPaintProperty('otm','raster-opacity',S.otmOp);
  // picked roads stand out, the others fade
  const pick=S.roads&&S.roadSel.size>0;
  if(map.getSource('roadpick'))map.getSource('roadpick').setData(ROADPICK);
  map.setPaintProperty('roads-hl','line-opacity',pick?.25:1);
  map.setPaintProperty('roads-hl-case','line-opacity',pick?.15:.55);
  const own=['in',['to-string',['get','ref']],['literal',[...S.roadSel]]];
  map.setPaintProperty('road-shields','icon-opacity',pick?['case',own,1,.3]:1);
  map.setPaintProperty('road-shields','text-opacity',pick?['case',own,1,.3]:1);
  REGION_LAYERS.forEach(id=>vis(id,S.regions));
  LAND_LAYERS.forEach(id=>vis(id,S.land));
  ['region-sel','region-sel-line'].forEach(id=>vis(id,S.regions||S.land));
  COUNTRY_LAYERS.forEach(id=>vis(id,S.countries));
  const sel=['in',['get','id'],['literal',[...S.sel]]];
  ['region-sel','region-sel-line','country-sel','country-sel-line'].forEach(id=>map.setFilter(id,sel));
  // only the large regions are dimmed (a small one lies inside a large one and would be dimmed twice)
  map.setFilter('region-dim',['all',['!',sel],['!',['has','kind']]]);map.setFilter('country-dim',['!',sel]);
  ['region-dim','country-dim'].forEach(id=>map.setPaintProperty(id,'fill-opacity',S.sel.size?.35:0));
  setMarked(S.trails);
  setSun();
  refreshTerrain();
}
map.on('load',apply);

/* road number shields, drawn on a canvas and stretched around the number (styles lose images on a switch, so they are made on demand) */
const SHIELD={motorway:['#c23b30','#ffffff'],trunk:['#d7672c','#ffffff'],primary:['#f5c04a','#2a2108'],minor:['#ece6cc','#2a2108']};
function makeShield(id){
  const [fill,edge]=SHIELD[id.slice(7)]||SHIELD.minor, r=2, W=24, H=20;
  const c=document.createElement('canvas');c.width=W*r;c.height=H*r;const g=c.getContext('2d');g.scale(r,r);
  g.fillStyle=fill;g.strokeStyle=edge;g.lineWidth=1.5;
  g.beginPath();g.roundRect(1,1,W-2,H-2,4);g.fill();g.stroke();
  map.addImage(id,g.getImageData(0,0,W*r,H*r),{pixelRatio:r,stretchX:[[6*r,18*r]],stretchY:[[6*r,14*r]],content:[5*r,4*r,19*r,16*r]});
}
map.on('styleimagemissing',e=>{if(e.id.startsWith('shield-')&&!map.hasImage(e.id))makeShield(e.id);});

/* ---------- controls ---------- */
function press(id,on){$(id).setAttribute('aria-pressed',on);}
function setColor(c){S.color=c;press('c-hyp',c==='hyp');press('c-uni',c==='uni');$('legend').hidden=c!=='hyp';apply();}
$('c-hyp').onclick=()=>setColor('hyp');
$('c-uni').onclick=()=>setColor('uni');
// minus / plus move the slider one step and reuse its input handler
function stepEx(dir){const el=$('ex'),st=+el.step||.5;el.value=Math.min(+el.max,Math.max(+el.min,+el.value+dir*st));el.dispatchEvent(new Event('input'));}
$('ex-minus').onclick=()=>stepEx(-1);
$('ex-plus').onclick=()=>stepEx(1);
$('ex').addEventListener('input',e=>{S.ex=+e.target.value;$('exv').textContent='×'+S.ex;map.setTerrain({source:'dem',exaggeration:S.ex});});
$('b-sat').onclick=()=>{S.satellite=!S.satellite;press('b-sat',S.satellite);apply();};
$('b-lbl').onclick=()=>{S.labels=!S.labels;press('b-lbl',S.labels);apply();};
$('b-roads').onclick=()=>{S.roads=!S.roads;press('b-roads',S.roads);apply();};
$('b-trails').onclick=()=>{S.trails=!S.trails;press('b-trails',S.trails);apply();};
$('b-contours').onclick=()=>{S.contours=!S.contours;press('b-contours',S.contours);$('contctl').hidden=!S.contours;apply();};
$('b-net').onclick=()=>{S.net=!S.net;press('b-net',S.net);apply();};
/* pick the height whose line stands out */
function setContourHi(v){
  v=(v===null||v===''||isNaN(+v))?null:Math.round(+v/10)*10;
  S.contourHi=v;$('chv').value=v===null?'':v;
  if(map.getSource('contourHi')){
    if(v!==null)map.getSource('contourHi').setTiles([contourHiTiles()]);
    const f=['==',['get','ele'],v??-99999];map.setFilter('contour-hi',f);map.setFilter('contour-hi-labels',f);}
  apply();
}
$('chv').addEventListener('change',e=>setContourHi(e.target.value));
$('ch-minus').onclick=()=>setContourHi((S.contourHi??260)-10);
$('ch-plus').onclick=()=>setContourHi((S.contourHi??240)+10);
$('ch-clear').onclick=()=>setContourHi(null);
$('b-contours').disabled=!window.mlcontour;
$('b-otm').onclick=()=>{S.otm=!S.otm;press('b-otm',S.otm);$('otmctl').hidden=!S.otm;apply();};
$('otmop').addEventListener('input',e=>{S.otmOp=+e.target.value;map.setPaintProperty('otm','raster-opacity',S.otmOp);refreshTerrain();});
$('b-tracks').onclick=()=>{S.tracks=!S.tracks;press('b-tracks',S.tracks);$('trackctl').hidden=!S.tracks;
  $('tracknote').textContent=map.getZoom()<9?'התקרבו כדי לראות את הדרכים':'';apply();};
map.on('zoomend',()=>{if(S.tracks)$('tracknote').textContent=map.getZoom()<9?'התקרבו כדי לראות את הדרכים':'';});
$('b-reset').onclick=()=>map.flyTo({...HOME,duration:1600});
/* layers menu: a list that opens above the bar; the button shows how many layers are on */
function layersOpen(on){$('layermenu').hidden=!on;$('b-layers').setAttribute('aria-expanded',on);}
$('b-layers').onclick=()=>layersOpen($('layermenu').hidden);
document.addEventListener('pointerdown',e=>{if(!$('layermenu').hidden&&!e.target.closest('#layers'))layersOpen(false);});
function countLayers(){const n=[...document.querySelectorAll('#layermenu button')].filter(b=>b.getAttribute('aria-pressed')==='true').length;$('layers-n').textContent=n?String(n):'';}
new MutationObserver(countLayers).observe($('layermenu'),{attributes:true,subtree:true,attributeFilter:['aria-pressed']});
countLayers();
/* help */
$('b-help').onclick=()=>{$('help').hidden=false;};
$('help-x').onclick=()=>{$('help').hidden=true;};
$('help').addEventListener('click',e=>{if(e.target===$('help'))$('help').hidden=true;});

function setDataMode(m,first){
  S.data=m;store.set('dataMode',m);
  press('m-local',m==='local');press('m-global',m==='global');
  // satellite needs the external service: off and disabled in local mode
  if(m==='local'){S.satellite=false;press('b-sat',false);}
  $('b-sat').disabled=m==='local';
  if(first)return;
  markedFailed=false;
  map.setStyle(buildStyle(),{diff:false});
  map.once('style.load',()=>{apply();const c=map.getCenter(),b=LOCAL_BOUNDS;
    if(m==='local'&&(c.lng<b[0]||c.lng>b[2]||c.lat<b[1]||c.lat>b[3]))map.flyTo({...HOME,duration:1600});});
  pins.forEach(P=>{P.z=null;P.err=false;readPin(P);});render();
}
$('m-local').onclick=()=>{if(S.data!=='local')setDataMode('local');};
$('m-global').onclick=()=>{if(S.data!=='global')setDataMode('global');};
setDataMode(S.data,true);
