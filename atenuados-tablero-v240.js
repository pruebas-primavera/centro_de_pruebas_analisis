/* Atenuados V-2.49 · Análisis y tablero (potencia RX_20h). Lee solo su propia IndexedDB; la única red son los mosaicos del mapa. */
function at240Analyzer(){
 let db,engine,snapshot;
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 let llave=null;const C250=at250Cripto();
 async function scan(m,fn,pass){for(let part=0;part<m.parts;part++){const chunk=await request(db.transaction('chunks').objectStore('chunks').get([m.id,part]));if(!chunk)throw Error('Falta un lote de la base guardada. Vuelve a cargarla.');const rows=await C250.dec(llave,chunk);for(const row of rows)fn(row);if(part%15===0)postMessage({type:'progress',message:pass+' · '+Math.min(m.count,(part+1)*1000).toLocaleString('es-MX')+' registros'});}}
 self.onmessage=async e=>{try{
  const d=e.data;
  if(d.type==='recalc'){if(!engine)throw Error('Pulsa Análisis de nuevo.');postMessage({type:'result',result:engine.summary(d.threshold,d.percentage,d.minimum),snapshot});return;}
  if(d.type!=='start')return;
  llave=d.key;if(!llave)throw Error('Abre Atenuados con la contraseña del día.');
  db=await request(indexedDB.open('primavera-atenuados-bases-v1',1));
  const meta=await request(db.transaction('meta').objectStore('meta').getAll()),c=meta.find(m=>m.kind==='clientes'),p=meta.find(m=>m.kind==='potencias'),matrix=meta.find(m=>m.kind==='matriz');
  if(!c||!p||!matrix)throw Error('Carga clientes, potencias y matriz antes de pulsar Análisis.');
  const rules=at240Rules(),cd=rules.cut(c.name),pd=rules.cut(p.name);
  if(pd<cd)throw Error('Base de potencias desactualizada. Carga una base de potencias con fecha igual o posterior al corte de clientes.');
  snapshot={clientDate:cd,powerDate:pd};const matrixRows=[];
  await scan(matrix,row=>matrixRows.push(row),'Leyendo matriz de puertos');
  engine=rules.create(c.headers,p.headers,matrixRows);
  await scan(c,engine.client,'Validando la base de clientes');
  await scan(p,engine.add,'Agrupando potencias del distrito');
  db.close();db=null;postMessage({type:'ready'});
  postMessage({type:'result',result:engine.summary(d.threshold,d.percentage,d.minimum),snapshot});
 }catch(err){db?.close();db=null;postMessage({type:'error',message:err.message});}};
}
(()=>{'use strict';
const $=id=>document.getElementById(id),fmt=n=>Number(n||0).toLocaleString('es-MX'),pct=n=>Number(n).toLocaleString('es-MX',{maximumFractionDigits:1})+' %';
const db=n=>n==null?'—':Number(n).toLocaleString('es-MX',{minimumFractionDigits:1,maximumFractionDigits:2}).replace('-','−');
const STATE={alert:'ATENUADO',drops:'POSIBLE DROP',below:'BAJO EL %',nomeasure:'SIN MEDICIONES'};
const ORDER={alert:0,drops:1,below:2,nomeasure:3};
// V-2.42: colores de cuentas acordados (rojo atenuada, verde en rango, gris OFF, café oscuro sin medición).
const ACCOUNT={low:['#d62828','Atenuada'],ok:['#2a9d4b','En rango'],off:['#9aa0a6','OFF'],miss:['#5b3a1e','Sin medición']};
let worker=null,result=null,running=false,generation=0,releaseLoad=null,baseMetas=[],baseSignature='',importBusy=false,tab=0;
let byId=new Map(),byIndex=[],accountsByPort=new Map(),accountIndex=new Map(),conflictIndex=new Map(),alertList=[],rowsById=new Map(),sortedPorts=[];
let selected='',filterOn=false,searched=null;           // searched = {account, portId}
let map=null,accountLayer=null,hint=null,districtBounds=null;

/* Parámetros */
function options(id,values,def,label){const s=$(id);for(const v of values){const o=document.createElement('option');o.value=v;o.textContent=label(v);if(v===def)o.selected=true;s.append(o);}}
options('at240-threshold',Array.from({length:16},(_,i)=>-20-i),-26,v=>v+' dBm');
options('at240-percentage',[5,10,15,20,25,30,35,40,45,50,60,70,80,90,100],30,v=>v+' %');
options('at240-minimum',[1,2,3,4,5,6,7,8,9,10,12,15,20],8,v=>String(v));
const parameters=()=>({threshold:Number($('at240-threshold').value),percentage:Number($('at240-percentage').value),minimum:Number($('at240-minimum').value)});

/* Estado del análisis */
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;}
function empty(message){
 result=null;selected='';filterOn=false;searched=null;districtBounds=null;$('at240-status').textContent=message;
 for(const e of document.querySelectorAll('[data-count]'))e.textContent='—';
 $('at240-priority').replaceChildren(el('p','empty','Sin resultados vigentes.'));$('at240-priority-note').textContent='De mayor a menor atención (cuentas atenuadas)';
 $('at240-dups').disabled=true;$('at240-export').disabled=true;$('at240-notes').textContent='';$('at240-olts').textContent='La matriz define los puertos del distrito.';
 $('at240-search').disabled=true;$('at240-search-go').disabled=true;rowsById=new Map();$('at240-export-missing').disabled=true;$('at240-export-nocoords').disabled=true;panel();clearMap();setHint('Pulsa Análisis para habilitar el mapa.');
}
function readiness(){
 const missing=['clientes','potencias','matriz'].filter(k=>!baseMetas.some(m=>m.kind===k&&m.count>0));
 if(missing.length)return {ready:false,message:'Carga '+missing.join(', ')+' para habilitar Análisis.'};
 try{const r=at240Rules(),c=r.cut(baseMetas.find(m=>m.kind==='clientes').name),p=r.cut(baseMetas.find(m=>m.kind==='potencias').name);if(p<c)return {ready:false,message:'Base de potencias desactualizada. Carga una base con fecha igual o posterior a clientes.'};}catch(e){return {ready:false,message:e.message};}
 return {ready:true,message:'Las tres bases están cargadas. Pulsa Análisis para procesarlas.'};
}
function runButton(){const b=$('at240-run');b.disabled=importBusy||running||!readiness().ready;b.setAttribute('aria-busy',String(running));b.textContent=running?'Analizando…':'Análisis';}
function invalidate(message){generation++;releaseLoad?.();releaseLoad=null;worker?.terminate();worker=null;running=false;empty(message);runButton();}
async function analyze(){
 if(running||importBusy)return;const state=readiness();if(!state.ready){empty(state.message);return;}
 if(!window.AT250?.key){empty('Abre Atenuados con la contraseña del día.');return;}
 let marcado=true;window.AT250.ocupado(true);const libre=()=>{if(marcado){marcado=false;window.AT250?.ocupado(false);}};
 const run=++generation;releaseLoad?.();releaseLoad=null;worker?.terminate();worker=null;running=true;empty('Preparando cruce local…');runButton();
 if(!navigator.locks){running=false;empty('Este navegador no permite coordinar el análisis local. Prueba con Chrome o Edge.');runButton();return;}
 try{await navigator.locks.request('primavera-atenuados-import-v1',async()=>{if(run!==generation)return;await new Promise(resolve=>{
  let released=false;const release=()=>{if(!released){released=true;resolve();}};releaseLoad=release;
  const url=URL.createObjectURL(new Blob([at240Rules.toString()+';'+at250Cripto.toString()+';('+at240Analyzer.toString()+')()'],{type:'text/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);worker=w;
  const fail=message=>{libre();w.terminate();if(worker===w)worker=null;running=false;release();if(run===generation)empty(message);runButton();};
  w.onerror=e=>fail('No se pudo ejecutar el análisis: '+(e.message||'el navegador lo bloqueó'));
  w.onmessage=e=>{if(run!==generation){release();return;}const m=e.data;
   if(m.type==='ready')release();
   else if(m.type==='progress')$('at240-status').textContent=m.message;
   else if(m.type==='error')fail(m.message);
   else if(m.type==='result'){libre();running=false;release();result=m.result;result.snapshot=m.snapshot;render();runButton();}};
  w.postMessage({type:'start',...parameters(),key:window.AT250?.key});
 });});}catch(e){libre();if(run===generation){running=false;empty(e.message);runButton();}}
}
// V-2.49: al bloquearse el módulo se destruye el análisis (sus datos descifrados viven en ese proceso).
window.addEventListener('at250-bloqueo',()=>{generation++;worker?.terminate();worker=null;result=null;});
function recalc(){
 if(worker&&result&&!running){running=true;runButton();$('at240-status').textContent='Recalculando con los nuevos parámetros…';worker.postMessage({type:'recalc',...parameters()});}
 else invalidate(readiness().ready?'Parámetros modificados. Pulsa Análisis para actualizar los resultados.':readiness().message);
}
window.addEventListener('at240-bases-changed',e=>{baseMetas=e.detail.bases;importBusy=e.detail.busy;const signature=JSON.stringify(baseMetas.map(m=>[m.kind,m.id]).sort());if(signature!==baseSignature){baseSignature=signature;invalidate(readiness().message);}else runButton();if(!result&&!running)$('at240-status').textContent=readiness().message;});
window.addEventListener('at240-import-start',()=>{importBusy=true;invalidate('Carga en curso. Al terminar, pulsa Análisis para procesar las tres bases.');});
window.addEventListener('at240-storage-error',e=>{baseMetas=[];importBusy=false;invalidate('Almacenamiento no disponible: '+e.detail);});
$('at240-run').onclick=analyze;
for(const id of ['at240-threshold','at240-percentage','at240-minimum'])$(id).onchange=recalc;

/* Render general */
function render(){
 const r=result,t=r.totals;byId=new Map(r.ports.map(p=>[p.id,p]));byIndex=[];for(const p of r.ports)byIndex[p.i]=p;
 accountsByPort=new Map();accountIndex=new Map();
 for(const a of r.accounts){let l=accountsByPort.get(a.p);if(!l){l=[];accountsByPort.set(a.p,l);}l.push(a);accountIndex.set(a.a,a);}
 conflictIndex=new Map(r.conflicts.map(c=>[c.account,c]));
 const count=s=>r.ports.filter(p=>p.state===s).length;
 const values={ports:r.ports.length,alert:count('alert'),drops:count('drops'),low:t.low,off:t.off,missing:t.missing,noCoords:t.noCoords,duplicates:t.duplicates};
 for(const e of document.querySelectorAll('[data-count]'))e.textContent=fmt(values[e.dataset.count]);
 $('at240-dups').disabled=!t.duplicates;$('at240-export').disabled=false;$('at240-export-missing').disabled=!t.missing;$('at240-export-nocoords').disabled=!t.noCoords;$('at240-search').disabled=false;$('at240-search-go').disabled=false;
 $('at240-status').textContent=`${fmt(t.accounts)} cuentas · ${fmt(r.ports.length)} puertos de la matriz · Umbral ≤ ${r.threshold} dBm · ${r.percentage} % · mínimo ${r.minimum} · Clientes ${r.snapshot.clientDate} · Potencias ${r.snapshot.powerDate}`;
 const notes=[];
 if(t.clientsCleaned)notes.push(fmt(t.clientsCleaned)+' cuentas de clientes con guion bajo final limpiadas');
 if(t.clientsDiscarded)notes.push(fmt(t.clientsDiscarded)+' registro(s) de clientes sin cuenta descartado(s)');
 if(t.powerDiscarded)notes.push(fmt(t.powerDiscarded)+' fila(s) de potencias sin cuenta descartada(s)');
 if(t.clientsOutside)notes.push(fmt(t.clientsOutside)+' clientes en puertos fuera de la matriz');
 $('at240-notes').textContent=notes.join(' · ');
 $('at240-olts').textContent='OLT del distrito según la matriz: '+r.olts.join(' · ');
 sortedPorts=[...r.ports].sort((a,b)=>ORDER[a.state]-ORDER[b.state]||b.low-a.low||b.percentage-a.percentage||a.label.localeCompare(b.label,'es'));
 alertList=sortedPorts.filter(p=>p.state==='alert');
 if(selected&&!byId.has(selected)){selected='';filterOn=false;}
 if(searched&&!byId.has(searched.portId))searched=null;
 ensureMap();if(map&&!districtBounds){districtBounds=bounds(r.accounts);if(districtBounds)map.fitBounds(districtBounds,{padding:[20,20]});}
 priority();panel();refreshMap();
}
function bounds(list){
 // Encuadre del distrito con los percentiles 2–98 de las coordenadas (las coordenadas aisladas no lo alejan).
 const la=[],lo=[];for(const a of list)if(a.lat!=null){la.push(a.lat);lo.push(a.lon);}
 if(!la.length)return null;la.sort((x,y)=>x-y);lo.sort((x,y)=>x-y);const q=(s,f)=>s[Math.min(s.length-1,Math.floor(s.length*f))];
 return [[q(la,.02),q(lo,.02)],[q(la,.98),q(lo,.98)]];
}

/* Mapa de cuentas: abre vacío y solo dibuja lo que el usuario elige */
function ensureMap(){
 if(map)return true;const box=$('at240-map');
 if(!window.L){box.querySelector('.map-empty').textContent='No se pudo cargar el mapa. Verifica la carpeta vendor/leaflet-1.9.4.';return false;}
 box.replaceChildren();map=L.map(box,{preferCanvas:true});
 // Mismo proveedor que Soportes (Esri): funciona también al abrir la herramienta como archivo local.
 const streets=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
 const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imágenes © Esri'});
 streets.addTo(map);L.control.layers({'Calles':streets,'Satélite':satellite},null,{position:'topright',collapsed:false}).addTo(map);   // V-2.45: botones Calles / Satélite siempre visibles
 map.setView([20.67,-103.43],12);accountLayer=L.layerGroup().addTo(map);
 hint=el('div','map-hint');box.append(hint);
 return true;
}
function setHint(text){if(hint){hint.textContent=text;hint.hidden=!text;}else{const p=$('at240-map').querySelector('.map-empty');if(p)p.textContent=text;}}
function clearMap(){if(accountLayer)accountLayer.clearLayers();}
function popupFor(a,p){
 const box=el('div','acc-pop');box.append(el('b','','Cuenta '+a.a),el('span','',a.v!=null?'Potencia RX_20h: '+db(a.v)+' dBm':'Potencia RX_20h: '+(a.why||ACCOUNT[a.s][1])),el('span','','Estado: '+ACCOUNT[a.s][1]),el('span','',p.label));return box;
}
function marker(a,p,radius){
 const [c]=ACCOUNT[a.s];
 return L.circleMarker([a.lat,a.lon],{radius,color:'#ffffff',weight:1.5,fillColor:c,fillOpacity:1}).bindPopup(()=>popupFor(a,p));
}
function refreshMap(){
 // Vuelve a dibujar el estado vigente (los estados de las cuentas cambian si cambia el umbral).
 if(!map)return;clearMap();
 if(filterOn&&selected){drawPort(byId.get(selected),searched&&searched.portId===selected?searched.account:null);return;}
 if(searched){const a=accountIndex.get(searched.account),p=byId.get(searched.portId);if(a&&p&&a.lat!=null){showSingle(a,p,false);return;}}
 setHint(selected?'Pulsa "Ver cuentas" para mostrar en el mapa las cuentas de '+byId.get(selected).label+'.':'Elige un puerto de la lista y pulsa "Ver cuentas", o busca una cuenta.');
}
function drawPort(p,focus){
 clearMap();const all=accountsByPort.get(p.i)||[],list=all.filter(a=>a.lat!=null);let focusMarker=null;
 for(const a of list){const m=marker(a,p,a.a===focus?9:6).addTo(accountLayer);if(a.a===focus)focusMarker=m;}
 if(!list.length){setHint(`${p.label}: ninguna de sus ${fmt(all.length)} cuentas tiene coordenadas en la base de clientes.`);return;}
 setHint(`${p.label} · ${fmt(list.length)} de ${fmt(all.length)} cuentas con coordenadas`);
 if(focusMarker){map.setView(focusMarker.getLatLng(),17);focusMarker.openPopup();return;}
 // Acerca el mapa al 90 % de cuentas más próximas a su mediana; las coordenadas aisladas no alejan la vista.
 const la=list.map(a=>a.lat).sort((x,y)=>x-y),lo=list.map(a=>a.lon).sort((x,y)=>x-y),mla=la[la.length>>1],mlo=lo[lo.length>>1];
 const far=a=>Math.hypot(a.lat-mla,(a.lon-mlo)*0.94),core=[...list].sort((x,y)=>far(x)-far(y)).slice(0,Math.max(1,Math.ceil(list.length*0.9)));
 map.stop();map.fitBounds(core.map(a=>[a.lat,a.lon]),{padding:[40,40],maxZoom:18});
}
function showSingle(a,p,fly=true){
 clearMap();const m=marker(a,p,9).addTo(accountLayer);setHint(`Cuenta ${a.a} · ${p.label}`);
 if(fly)map.setView([a.lat,a.lon],17);m.openPopup();
}

/* Lista de puertos atenuados (completa, altura fija con barra lateral) */
function priority(){
 const box=$('at240-priority');box.replaceChildren();rowsById=new Map();
 if(!alertList.length){box.append(el('p','empty','Ningún puerto alcanza los criterios de atenuación.'));return;}
 $('at240-priority-note').textContent=`${fmt(alertList.length)} puertos · de mayor a menor atención (cuentas atenuadas)`;
 const max=alertList[0].low,frag=document.createDocumentFragment();
 alertList.forEach((p,i)=>{const b=el('button','prio');b.type='button';b.dataset.port=p.id;b.title=`${p.label} · ${fmt(p.low)} atenuadas · ${pct(p.percentage)}`;
  const bar=el('span','bar'),fill=el('span');fill.style.width=(100*p.low/max)+'%';bar.append(fill);
  b.append(el('span','n',i+1),el('span','name',p.label),bar,el('b','',fmt(p.low)));b.onclick=()=>select(p.id);rowsById.set(p.id,b);frag.append(b);});
 box.append(frag);marks();
}
function marks(){for(const [id,b] of rowsById){b.classList.toggle('selected',id===selected);b.classList.toggle('searched',!!searched&&id===searched.portId&&id!==selected);b.setAttribute('aria-current',id===selected?'true':'false');}}
function reveal(id){
 // Solo mueve la barra si el puerto no está a la vista; la lista conserva su orden.
 const box=$('at240-priority'),b=rowsById.get(id);if(!b)return;
 const top=b.offsetTop,bottom=top+b.offsetHeight;
 if(top<box.scrollTop||bottom>box.scrollTop+box.clientHeight)box.scrollTop=Math.max(0,top-box.clientHeight/2+b.offsetHeight/2);
}
function select(id){
 selected=id;marks();panel();
 if(filterOn)drawPort(byId.get(id),searched&&searched.portId===id?searched.account:null);   // El filtro se respeta al cambiar de puerto.
 else if(!searched)setHint('Pulsa "Ver cuentas" para mostrar en el mapa las cuentas de '+byId.get(id).label+'.');
}
function back(){
 selected='';filterOn=false;searched=null;marks();panel();clearMap();
 setHint('Elige un puerto de la lista y pulsa "Ver cuentas", o busca una cuenta.');
 if(map&&districtBounds)map.fitBounds(districtBounds,{padding:[20,20]});
}

/* V-2.51 · Buscador de puerto en "Detalle de puerto".
   Sintaxis estricta: <OLT con guion bajo> <frame/slot/puerto con "/">. Se pueden omitir palabras completas al inicio
   del nombre (FUENTES_GDL → LAS_FUENTES_GDL) solo si el resto identifica UNA sola OLT de la matriz. Mayúsculas/minúsculas iguales. */
let portSearchBox=null;
function portHead(){
 if(!portSearchBox){
  const wrap=el('div','port-search'),q=el('input'),go=el('button','','Buscar');
  q.type='search';q.id='at251-port-q';q.placeholder='Buscar puerto · ej. LAS_FUENTES_GDL 0/5/9';q.setAttribute('aria-label','Buscar puerto atenuado: OLT y frame/slot/puerto');q.autocomplete='off';q.spellcheck=false;
  go.type='button';go.id='at251-port-go';go.onclick=()=>findPort(q.value);
  q.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findPort(q.value);}});
  wrap.append(q,go);portSearchBox=wrap;
 }
 const on=!!result;for(const c of portSearchBox.children)c.disabled=!on;
 const head=el('div','port-head');head.append(el('h2','','Detalle de puerto'),portSearchBox);return head;
}
function parsePortQuery(text){
 const m=/^\s*([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)\s+(\d+)\/(\d+)\/(\d+)\s*$/.exec(String(text||''));
 if(!m)return null;
 return {name:m[1].toUpperCase(),nums:[+m[2],+m[3],+m[4]]};
}
function findPort(text){
 if(!result)return;
 const T='Búsqueda de puerto';
 if(!String(text||'').trim()){say('Escribe el puerto, por ejemplo LAS_FUENTES_GDL 0/5/9.',T);return;}
 const bad='No se encontró ese puerto en la matriz, revisa sintaxis.';
 const q=parsePortQuery(text);if(!q){say(bad,T);return;}
 const olts=result.olts.filter(o=>{const u=String(o).toUpperCase();return u===q.name||u.endsWith('_'+q.name);});
 if(olts.length!==1){say(bad,T);return;}
 const key=String(olts[0]).toUpperCase()+' '+q.nums.join('/');
 const port=result.ports.find(p=>{const sp=p.label.lastIndexOf(' ');return p.label.slice(0,sp).toUpperCase()+' '+p.label.slice(sp+1).split('/').map(Number).join('/')===key;});
 if(!port){say(bad,T);return;}
 if(port.state!=='alert'||!rowsById.has(port.id)){say(`El puerto no está atenuado.\n${port.label}`,T);return;}
 select(port.id);
 // Lleva la lista hasta el puerto (centrado). La lista tiene desplazamiento suave: se calcula un destino fijo con offsetTop.
 const box=$('at240-priority'),row=rowsById.get(port.id);
 if(box&&row){const target=Math.max(0,Math.min(box.scrollHeight-box.clientHeight,row.offsetTop-(box.clientHeight-row.offsetHeight)/2));
  if(row.offsetTop<box.scrollTop||row.offsetTop+row.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTo({top:target});}
}

/* Detalle de puerto */
function panel(){
 const box=$('at240-port'),p=byId.get(selected);box.replaceChildren();box.classList.toggle('is-empty',!p);
 if(!p){
  // V-2.43: la ventana queda fija; sin puerto elegido muestra todo en cero y los botones desactivados.
  box.append(portHead(),el('p','port-full','Selecciona un puerto de la lista'));
  const g=el('div','port-fields');for(const l of ['Cuentas','Atenuadas','Potencias en rango','OFF','Sin medición','Duplicadas','Sin coordenadas','%','Estado']){const d=el('div',l==='Atenuadas'?'hot':'');d.append(el('strong','',l==='%'?'0 %':l==='Estado'?'—':'0'),el('span','',l));g.append(d);}
  box.append(g,el('p','port-meta','Mediana — · peor — · mejor —'));
  const act=el('div','port-actions');for(const [t,c] of [['Regresar',''],['Exportar cuentas',''],['Exportar puertos',''],['Gráfica',''],['Ver cuentas','primary']]){const b=el('button',c,t);b.type='button';b.disabled=true;if(t==='Exportar puertos')portsButton(b);act.append(b);}
  box.append(act);drawChart();return;
 }
 const all=accountsByPort.get(p.i)||[],noCoords=all.filter(a=>a.lat==null).length,shown=all.length-noCoords;
 box.append(portHead(),el('p','port-full',p.label));
 const grid=el('div','port-fields');
 const field=(value,label,hot)=>{const d=el('div',hot?'hot':'');d.append(el('strong','',value),el('span','',label));grid.append(d);};
 field(fmt(p.total),'Cuentas');field(fmt(p.low),'Atenuadas',true);field(fmt(p.good),'Potencias en rango');
 field(fmt(p.off),'OFF');field(fmt(p.missing),'Sin medición');field(fmt(p.dup),'Duplicadas');
 field(fmt(noCoords),'Sin coordenadas');field(p.measured?pct(p.percentage):'—','%');
 const st=el('div');st.append(el('span','badge '+p.state,STATE[p.state]),el('span','','Estado'));grid.append(st);
 box.append(grid);
 const meta=[`Mediana ${db(p.median)} dBm`,`peor ${db(p.worst)}`,`mejor ${db(p.best)}`];
 box.append(el('p','port-meta',meta.join(' · ')));
 const actions=el('div','port-actions');
 const ret=el('button','','Regresar');ret.type='button';ret.id='at240-back';ret.onclick=back;
 const exp=el('button','','Exportar cuentas');exp.type='button';exp.id='at240-export-port';exp.disabled=!p.total;exp.title='Excel con todas las cuentas del puerto, su potencia RX_20h y coordenadas';exp.onclick=()=>exportPort(p);
 const see=el('button','primary',filterOn?`En mapa: ${fmt(shown)}`:`Ver ${fmt(all.length)} cuentas`);see.type='button';see.id='at240-show-accounts';see.disabled=filterOn;
 see.title=filterOn?'El filtro se quita con Regresar':`${fmt(shown)} con coordenadas se mostrarán en el mapa`;see.onclick=()=>{filterOn=true;drawPort(p,searched&&searched.portId===p.id?searched.account:null);panel();};
 const gr=el('button','','Gráfica');gr.type='button';gr.id='at240-chart-btn';gr.title='Comportamiento del puerto de RX_00h a RX_20h';gr.onclick=()=>{const w=$('at240-chart'),first=w.hidden;w.hidden=false;if(first)placeChart();drawChart();$('at240-chart-x').focus();};
 const ports=el('button','','Exportar puertos');ports.type='button';portsButton(ports);
 actions.append(ret,exp,ports,gr,see);box.append(actions);drawChart();
}

/* V-2.45 · Gráfica de comportamiento del puerto (RX_00h…RX_20h). Solo se cierra con la X; sigue al puerto elegido. */
$('at240-chart-x').onclick=()=>{$('at240-chart').hidden=true;};
let avgOn=false;
function drawChart(){
 const win=$('at240-chart');if(win.hidden)return;
 const body=$('at240-chart-body');body.replaceChildren();
 const p=byId.get(selected);
 if(!p||!result){body.append(el('h3','','Comportamiento del puerto'),el('p','chart-sub','Selecciona un puerto de la lista para ver su gráfica.'));return;}
 const HRS=['00 h','04 h','08 h','12 h','16 h','20 h'],T=result.threshold,ST=Math.max(-24.5,T),TOP=-16,BOT=Math.min(-33,T-3);
 const C={ok:'#5fae7b',deg:'#d99a52',low:'#d4625f',okBg:'rgba(95,174,123,.13)',degBg:'rgba(217,154,82,.14)',lowBg:'rgba(212,98,95,.13)'};
 const acc=accountsByPort.get(p.i)||[];
 const st=HRS.map((_,i)=>{const v=acc.map(a=>a.h?a.h[i]:null).filter(x=>x!=null);
  return {avg:v.length?v.reduce((s,x)=>s+x,0)/v.length:null,ok:v.filter(x=>x>=ST&&x>T).length,deg:v.filter(x=>x<ST&&x>T).length,low:v.filter(x=>x<=T).length,miss:acc.length-v.length};});
 const ns='http://www.w3.org/2000/svg',n=(s,t,a,x)=>{const e=document.createElementNS(ns,t);for(const k in a)e.setAttribute(k,a[k]);if(x!==undefined)e.textContent=x;s.append(e);return e;};
 const f1=v=>(Math.round(v*10)/10).toFixed(1).replace('-','−');
 const W=640,Hh=330,x0=52,x1=W-104,y0=14,y1=262,clamp=v=>Math.max(BOT,Math.min(TOP,v)),y=v=>y0+(TOP-clamp(v))/(TOP-BOT)*(y1-y0),x=i=>x0+44+i*((x1-x0-88)/5);
 const h3=el('h3','',p.label);h3.id='at240-chart-title';
 body.append(h3,el('p','chart-sub',`${fmt(p.total)} cuentas${p.dup?` (${fmt(p.dup)} duplicada${p.dup>1?'s':''} no se grafica${p.dup>1?'n':''})`:''} · promedio del puerto y cuentas por franja en cada hora · umbral ${T} dBm · promedio por franja con RX_20h`));
 const s=document.createElementNS(ns,'svg');s.setAttribute('viewBox',`0 0 ${W} ${Hh}`);s.setAttribute('class','chart-svg');s.setAttribute('role','img');s.setAttribute('aria-label','Comportamiento del puerto '+p.label);
 if(ST>T)n(s,'rect',{x:x0,y:y(TOP),width:x1-x0,height:y(ST)-y(TOP),fill:C.okBg}),n(s,'rect',{x:x0,y:y(ST),width:x1-x0,height:y(T)-y(ST),fill:C.degBg});
 else n(s,'rect',{x:x0,y:y(TOP),width:x1-x0,height:y(T)-y(TOP),fill:C.okBg});
 n(s,'rect',{x:x0,y:y(T),width:x1-x0,height:y(BOT)-y(T),fill:C.lowBg});
 const zt=(y,c,t)=>n(s,'text',{x:x1+8,y:y+4,'font-size':11,fill:c,'font-weight':'bold'},t);
 zt((y(TOP)+y(ST))/2,C.ok,'ESTABLE');if(ST>T)zt((y(ST)+y(T))/2,C.deg,'DEGRADÁNDOSE');zt((y(T)+y(BOT))/2,C.low,'ATENUADA');
 // V-2.46: promedio de potencia de las cuentas del puerto en cada franja, con la lectura RX_20h.
 const v20=acc.map(a=>a.h?a.h[5]:null).filter(v=>v!=null);
 const rng=(lo,hi)=>{const v=v20.filter(x=>x>lo&&x<=hi);if(!v.length)return 'sin cuentas';return 'Promedio '+f1(v.reduce((a,b)=>a+b,0)/v.length);};
 const rt=(yy,c,t)=>n(s,'text',{x:x1+8,y:yy,'font-size':10.5,fill:c,opacity:.9},t);
 rt((y(TOP)+y(ST))/2-12,C.ok,rng(ST>T?ST-1e-9:T,Infinity));
 if(ST>T)rt((y(ST)+y(T))/2-12,C.deg,rng(T,ST-1e-9));
 rt((y(T)+y(BOT))/2+20,C.low,rng(-Infinity,T));
 for(const v of [...new Set([TOP,-20,ST,T,-30,BOT])]){n(s,'path',{d:`M${x0} ${y(v)}H${x1}`,stroke:'#2f2f2f'});n(s,'text',{x:x0-6,y:y(v)+4,'text-anchor':'end','font-size':10,fill:'#8a8a8a'},f1(v));}
 n(s,'path',{d:`M${x0} ${y(T)}H${x1}`,stroke:'#e0e0e0','stroke-dasharray':'5 4','stroke-width':1});
 st.forEach((v,i)=>{
  const badge=(cy,col,num)=>{n(s,'rect',{x:x(i)-26,y:cy-11,width:52,height:22,rx:11,fill:'#1c1c1c',stroke:col,'stroke-width':1.2});n(s,'circle',{cx:x(i)-13,cy,r:6,fill:col});n(s,'text',{x:x(i)-3,y:cy+4,'font-size':12,fill:col,'font-weight':'bold'},num);};
  badge(y(TOP)+22,C.ok,v.ok);if(ST>T)badge((y(ST)+y(T))/2,C.deg,v.deg);badge(y(BOT)-22,C.low,v.low);
  n(s,'text',{x:x(i),y:y1+20,'text-anchor':'middle','font-size':12,fill:'#e8e8e8'},HRS[i]);
  if(v.miss)n(s,'text',{x:x(i),y:y1+36,'text-anchor':'middle','font-size':10,fill:'#8a8a8a'},`${v.miss} sin lectura`);});
 const g=n(s,'g',{class:'avg'}),pts=st.map((v,i)=>v.avg==null?null:[x(i),y(v.avg)]);
 let d='';pts.forEach(q=>{if(q)d+=(d&&pts[pts.indexOf(q)-1]?'L':'M')+q[0]+' '+q[1];});
 if(d)n(g,'path',{d,fill:'none',stroke:'#f2f2f2','stroke-width':2.5});
 st.forEach((v,i)=>{if(v.avg==null)return;n(g,'circle',{cx:x(i),cy:y(v.avg),r:4.5,fill:'#f2f2f2'});n(g,'text',{x:x(i)+8,y:y(v.avg)+16,'font-size':11,fill:'#f2f2f2','font-weight':'bold',stroke:'#1c1c1c','stroke-width':4,'paint-order':'stroke'},f1(v.avg));});
 body.append(s);body.classList.toggle('avg-on',avgOn);
 const lg=el('div','chart-legend');
 const b=el('button','avg-btn');b.type='button';b.setAttribute('aria-pressed',String(avgOn));b.append(el('i'),'Promedio del puerto');
 b.onclick=()=>{avgOn=!avgOn;b.setAttribute('aria-pressed',String(avgOn));body.classList.toggle('avg-on',avgOn);};
 lg.append(b);
 for(const [c,t] of [[C.ok,`Estables (${f1(ST)} o mejor)`],...(ST>T?[[C.deg,'Degradándose']]:[]),[C.low,`Atenuadas (≤ ${f1(T)})`]]){const sp=el('span');const i=el('i');i.style.background=c;sp.append(i,t);lg.append(sp);}
 body.append(lg);fitChart();
}
// La gráfica se ajusta al alto disponible del mapa en cada pantalla.
function fitChart(){const win=$('at240-chart'),svg=win.querySelector('.chart-svg');if(win.hidden||!svg)return;svg.style.height='';const room=innerHeight-24,extra=win.scrollHeight-svg.getBoundingClientRect().height;svg.style.height=Math.max(160,Math.min(svg.getBoundingClientRect().height,room-extra))+'px';}
addEventListener('resize',()=>{const w=$('at240-chart');if(w.hidden)return;keepInside(parseFloat(w.style.left)||0,parseFloat(w.style.top)||0);fitChart();});
/* V-2.45 · La ventana de la gráfica se mueve manteniéndola presionada en cualquier parte (salvo sus botones). */
// V-2.46: sin topes; solo queda visible una franja de 40 px para poder volver a agarrarla.
function keepInside(x,y){const w=$('at240-chart'),r=w.getBoundingClientRect(),k=40;w.style.left=Math.max(k-r.width,Math.min(innerWidth-k,x))+'px';w.style.top=Math.max(k-r.height,Math.min(innerHeight-k,y))+'px';}
function placeChart(){const m=$('at240-map').getBoundingClientRect();keepInside(m.left+14,m.top+10);}
(()=>{const w=$('at240-chart');let drag=null;
 w.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const r=w.getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top,id:e.pointerId};w.setPointerCapture(e.pointerId);w.classList.add('dragging');e.preventDefault();});
 w.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;keepInside(e.clientX-drag.dx,e.clientY-drag.dy);});
 const end=e=>{if(!drag||e.pointerId!==drag.id)return;drag=null;w.classList.remove('dragging');};
 w.addEventListener('pointerup',end);w.addEventListener('pointercancel',end);
})();

/* Buscador de cuentas */
const msg=$('at240-msg');
function say(text,title='Búsqueda de cuenta'){$('at240-msg-title').textContent=title;$('at240-msg-text').textContent=text;if(!msg.open)msg.showModal();$('at240-msg-ok').focus();}
$('at240-msg-ok').onclick=()=>msg.close();
msg.addEventListener('click',()=>msg.close());   // Se cierra con un clic en cualquier parte del tablero.
function powerText(a){return a.v!=null?db(a.v)+' dBm':ACCOUNT[a.s][1];}
$('at240-search-form').onsubmit=e=>{
 e.preventDefault();if(!result)return;
 const q=at240Rules().account($('at240-search').value);
 if(!q){say('Escribe un número de cuenta.');return;}
 const a=accountIndex.get(q),c=conflictIndex.get(q);
 if(selected){                                              // Con puerto elegido: busca solo en ese puerto.
  const p=byId.get(selected);
  if(a&&a.p===p.i){
   searched={account:q,portId:p.id};marks();
   if(a.lat==null){say(`La cuenta ${q} pertenece a este puerto (${p.label}) pero no tiene coordenadas en la base de clientes; no se puede ubicar en el mapa.\nPotencia: ${powerText(a)}.`);return;}
   if(filterOn)drawPort(p,q);else showSingle(a,p);return;
  }
  if(c&&c.records.some(r=>r.label===p.label)){say(`La cuenta ${q} está en este puerto, pero es una cuenta duplicada por revisar (${c.reason.toLowerCase()}), por eso no se muestra en el mapa. Consulta la lista de Cuentas duplicadas.`);return;}
  say('La cuenta no se encuentra en el periodo o puerto seleccionado.');return;
 }
 searched=null;marks();clearMap();setHint('Elige un puerto de la lista y pulsa "Ver cuentas", o busca una cuenta.');   // Cada búsqueda limpia la anterior.
 if(!a&&!c){say('La cuenta no se encuentra en las bases cargadas.');return;}
 if(!a){                                                    // Solo existe como duplicada.
  const target=c.records.map(r=>alertList.find(x=>x.label===r.label)).find(Boolean);
  if(target){searched={account:q,portId:target.id};marks();reveal(target.id);}
  say(`La cuenta ${q} está duplicada por revisar (${c.reason.toLowerCase()}: ${[...new Set(c.records.map(r=>r.label))].join(', ')}), por eso no se muestra en el mapa. Consulta la lista de Cuentas duplicadas.`);return;
 }
 const p=byIndex[a.p];
 if(p.state!=='alert'){say(`La cuenta ${q} pertenece al puerto ${p.label} (${STATE[p.state]}), que no está dentro de los puertos atenuados.\nPotencia: ${powerText(a)}.`);return;}
 searched={account:q,portId:p.id};marks();reveal(p.id);
 if(a.lat==null){clearMap();setHint('');say(`La cuenta ${q} pertenece al puerto atenuado ${p.label}, resaltado en la lista. No tiene coordenadas en la base de clientes, por eso no se puede ubicar en el mapa.\nPotencia: ${powerText(a)}.`);return;}
 showSingle(a,p);
};

/* Duplicadas */
/* Exportaciones */
function save(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function download(name,rows){
 const safe=v=>typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v,quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 save(name,new Blob(['﻿'+rows.map(r=>r.map(v=>quote(safe(v))).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
}
// Excel .xlsx mínimo (una hoja), generado en el navegador sin librerías ni red. Textos como texto (conservan ceros a la izquierda).
const crcT=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(u){let c=0xffffffff;for(let i=0;i<u.length;i++)c=crcT[(c^u[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 for(const [name,text] of files){
  const n=enc.encode(name),d=enc.encode(text),crc=crc32(d),h=new DataView(new ArrayBuffer(30));
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint32(14,crc,true);h.setUint32(18,d.length,true);h.setUint32(22,d.length,true);h.setUint16(26,n.length,true);
  parts.push(h,n,d);
  const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);c.setUint32(20,d.length,true);c.setUint32(24,d.length,true);c.setUint16(28,n.length,true);c.setUint32(42,offset,true);
  central.push(c,n);offset+=30+n.length+d.length;
 }
 const size=central.reduce((s,x)=>s+x.byteLength,0),e=new DataView(new ArrayBuffer(22));
 e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,e],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function xlsx(sheet,rows,widths){
 const x=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const col=i=>{let s='';i++;while(i){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;};
 const body=rows.map((r,ri)=>`<row r="${ri+1}">`+r.map((v,ci)=>{const ref=col(ci)+(ri+1),st=ri===0?' s="1"':'';
  if(v&&typeof v==='object'&&Number.isFinite(v.d))return `<c r="${ref}" s="2"><v>${Math.round(v.d*100)/100}</v></c>`;   // V-2.46: potencia con 2 decimales
  return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}"${st}><v>${v}</v></c>`:`<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(v??'')}</t></is></c>`;}).join('')+'</row>').join('');
 const cols='<cols>'+widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+'</cols>';
 return zip([
  ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
  ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ['xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`]
 ]);
}
// V-2.46: potencias en Excel como número con 2 decimales; lo que no es número va tal como viene.
function pw(t){const s=String(t??'').trim().replace(/−/g,'-');return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)?{d:Number(s)}:String(t??'').trim();}
const coordText=(lat,lon)=>lat==null||lon==null?'':`${lat},${lon}`;
function exportPort(p){
 // V-2.46: todas las cuentas del puerto. Potencia RX_20h: número si es válida; si no, el valor del archivo de potencias;
 // vacío si la cuenta no viene en potencias. Coordenadas vacías si el cliente no las tiene. Duplicadas: una fila por registro + columna POTENCIAS.
 const rows=[['OLT FRAME/SLOT/PUERTO','CUENTA','POTENCIA RX_20h (dBm)','COORDENADAS','POTENCIAS']];
 const all=accountsByPort.get(p.i)||[],raw20=a=>a.s==='low'||a.s==='ok'?{d:a.v}:a.s==='off'?'OFF':a.r?pw(a.r[5]):'';
 const rank=a=>a.s==='low'||a.s==='ok'?0:a.s==='off'?1:a.r?2:3;
 for(const a of [...all].sort((x,y)=>rank(x)-rank(y)||(rank(x)===0?x.v-y.v:String(x.a).localeCompare(String(y.a)))))rows.push([p.label,a.a,raw20(a),coordText(a.lat,a.lon),'']);
 const dup=(result.conflicts||[]).filter(c=>c.records.some(r=>r.label===p.label)).sort((x,y)=>String(x.account).localeCompare(String(y.account)));
 for(const c of dup){const all=c.records.map(r=>{const v=pw(r.raw);return typeof v==='object'?(Math.round(v.d*100)/100).toFixed(2):(v||'(vacío)');}).join(' / ');
  for(const r of c.records)rows.push([r.label,c.account,pw(r.raw),coordText(c.lat,c.lon),all]);}
 save(`CUENTAS_${p.label.replace(/[^A-Z0-9]+/gi,'_')}_${result.snapshot.powerDate}_U${result.threshold}.xlsx`,xlsx('Cuentas',rows,[30,16,22,26,24]));
}
// V-2.52 · Excel de todos los puertos atenuados (mismo orden de la lista) con lo que muestra "Detalle de puerto".
function portsButton(b){b.id='at252-export-ports';b.disabled=!result||!alertList.length;b.title='Excel con todos los puertos atenuados y su detalle';b.onclick=exportPorts;}
function exportPorts(){
 if(!result||!alertList.length)return;
 const rows=[['#','PUERTO','CUENTAS','ATENUADAS','POTENCIAS EN RANGO','OFF','SIN MEDICIÓN','DUPLICADAS','SIN COORDENADAS','% ATENUADAS','ESTADO','MEDIANA (dBm)','PEOR (dBm)','MEJOR (dBm)']];
 const n=v=>v==null||!Number.isFinite(v)?'':{d:v};
 alertList.forEach((p,i)=>{const all=accountsByPort.get(p.i)||[];
  rows.push([i+1,p.label,p.total,p.low,p.good,p.off,p.missing,p.dup,all.filter(a=>a.lat==null).length,p.measured?{d:p.percentage}:'',STATE[p.state],n(p.median),n(p.worst),n(p.best)]);});
 save(`PUERTOS_ATENUADOS_${result.snapshot.powerDate}_U${result.threshold}_P${result.percentage}_M${result.minimum}.xlsx`,xlsx('Puertos atenuados',rows,[5,28,10,11,18,7,13,12,16,13,13,14,12,12]));
}
function exportMissing(){
 // Excel de cuentas sin medición: ubicación, las 6 lecturas tal como vienen y el motivo.
 if(!result)return;const H=['RX_00h','RX_04h','RX_08h','RX_12h','RX_16h','RX_20h'];
 const rows=[['CUENTA','OLT','FRAME','SLOT','PUERTO',...H,'MOTIVO']];
 const val=pw;   // V-2.46: 2 decimales
 const list=result.accounts.filter(a=>a.s==='miss').sort((x,y)=>x.p-y.p||String(x.a).localeCompare(String(y.a)));
 for(const a of list){const p=byIndex[a.p];rows.push([a.a,p.olt,Number(p.frame),Number(p.slot),Number(p.port),...(a.r?a.r.map(val):H.map(()=>'')),a.why||'']);}
 save(`SIN_MEDICION_${result.snapshot.powerDate}.xlsx`,xlsx('Sin medicion',rows,[14,24,8,8,8,10,10,10,10,10,10,36]));
}
$('at240-export-missing').onclick=exportMissing;
// V-2.46: Excel de cuentas sin coordenadas (mismo universo que el indicador) para completar la base de clientes.
$('at240-export-nocoords').onclick=()=>{if(!result)return;const rows=[['OLT FRAME/SLOT/PUERTO','CUENTA']];
 for(const c of [...(result.noCoordList||[])].sort((x,y)=>x.label.localeCompare(y.label)||String(x.a).localeCompare(String(y.a))))rows.push([c.label,c.a]);
 save(`SIN_COORDENADAS_${result.snapshot.clientDate}.xlsx`,xlsx('Sin coordenadas',rows,[30,16]));};
// V-2.46: el indicador de duplicadas descarga directo el Excel (antes abría una ventana con la lista y un CSV).
$('at240-dups').onclick=()=>{if(!result)return;const rows=[['CUENTA','DIFERENCIA','OLT Y PUERTO','POTENCIA','SN','FILA EN POTENCIAS']];
 for(const c of result.conflicts)for(const r of c.records)rows.push([c.account,c.reason,r.label,pw(r.raw),r.sn,r.excelRow]);
 save(`DUPLICADAS_${result.snapshot.powerDate}.xlsx`,xlsx('Duplicadas',rows,[16,18,30,12,18,18]));};
const tag=()=>`${result.snapshot.powerDate}_U${result.threshold}_P${result.percentage}_M${result.minimum}`;
$('at240-export').onclick=()=>{if(!result)return;download(`ATENUADOS_PUERTOS_${tag()}.csv`,[['OLT','FRAME','SLOT','PUERTO','CLUSTER','CUENTAS','CON POTENCIA','ATENUADAS','POTENCIAS EN RANGO','OFF','SIN MEDICION','DUPLICADAS','PORCENTAJE','MEDIANA DBM','ESTADO'],
 ...sortedPorts.map(p=>[p.olt,p.frame,p.slot,p.port,p.cluster,p.total,p.measured,p.low,p.good,p.off,p.missing,p.dup,p.measured?Math.round(p.percentage*100)/100:'',p.median??'',STATE[p.state]])]);};

/* Pestañas */
const tabs=[$('tab-atenuados'),$('tab-dashboard')];
function activate(i,focus=false){tab=i;tabs.forEach((b,n)=>{b.setAttribute('aria-selected',String(n===i));b.tabIndex=n===i?0:-1;$(b.getAttribute('aria-controls')).hidden=n!==i;});if(focus)tabs[i].focus();if(i===0&&map)setTimeout(()=>map.invalidateSize(),0);}
tabs.forEach((b,i)=>{b.onclick=()=>activate(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();activate(e.key==='Home'?0:e.key==='End'?1:1-tab,true);}};});
$('back-atenuados').onclick=()=>activate(0,true);
// V-2.44: el mapa se reajusta cuando cambia el tamaño de la ventana.
window.addEventListener('resize',()=>{if(map)map.invalidateSize();});

empty('Carga clientes, potencias y matriz. Después pulsa Análisis.');runButton();
})();
