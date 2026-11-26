/* Atenuados V-2.43 · Reglas puras del módulo (potencia RX_20h). Sin red, sin DOM y sin acceso a otros módulos.
   Se ejecuta en la página y dentro de los Workers de carga y análisis. */
function at240Rules(){
 'use strict';
 const key=v=>String(v??'').trim();
 const INVALID=new Set(['','-','--','#N/A','#N/D','N/A','NA']);
 // Regla 9 y 10: recorta espacios, quita el guion bajo final y descarta cuentas inválidas.
 function account(v){const a=key(v).replace(/_+$/,'').trim();return INVALID.has(a.toUpperCase())?'':a;}
 const hadUnderscore=v=>/_+\s*$/.test(String(v??''));
 const olt=v=>key(v).toUpperCase();
 function cut(name){
  const m=/_([0-9]{4}-[0-9]{2}-[0-9]{2})\.xlsx$/i.exec(name);
  if(!m)throw Error('Nombre de archivo inválido. Incluye la fecha de corte al final, en formato AAAA-MM-DD. Ejemplo: CLIENTES_PRIMAVERA_2026-11-01.xlsx. Corrige el nombre y vuelve a seleccionar el archivo.');
  const d=new Date(m[1]+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==m[1])throw Error('La fecha de corte del nombre no es válida. Corrige el nombre y vuelve a seleccionar el archivo.');
  return m[1];
 }
 const norm=h=>key(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
 function columns(headers,kind){
  const names=headers.map(norm),find=(...v)=>names.findIndex(x=>v.includes(x));
  const c={account:find('cuenta'),olt:find('olt'),frame:find('frame','frameop'),slot:find('slot','slotop'),port:find('port','puerto','portop'),coord:find('coordenadas','coordendanas'),cluster:find('cluster'),sn:find('sn'),power:-1};
  if(['account','olt','frame','slot','port'].some(k=>c[k]<0))throw Error('Archivo con datos incompletos, favor de corregirlos. Debe contener Cuenta, OLT, FRAME, SLOT y PUERTO.');
  if(kind==='potencias'){
   // Regla 1 (V-2.43): la potencia es RX_20h (bajada, coincide con el gestor), localizada por su encabezado.
   c.power=names.findIndex(x=>x==='rx20h');
   if(c.power<0)throw Error('No se encontró la columna de potencia RX_20h en la base de potencias. Revisa el encabezado del archivo.');
   // Las 6 lecturas del día solo se conservan para exportar el detalle de "Sin medición".
   c.readings=['rx00h','rx04h','rx08h','rx12h','rx16h','rx20h'].map(h=>names.findIndex(x=>x===h));
  }
  return c;
 }
 function location(v,c){
  const o=olt(v[c.olt]),parts=[c.frame,c.slot,c.port].map(i=>key(v[i]));
  if(!o||['-','0','#N/A','#N/D'].includes(o)||parts.some(x=>!/^\d+$/.test(x)))return null;
  const p=parts.map(x=>String(Number(x)));return {olt:o,frame:p[0],slot:p[1],port:p[2],id:o+' '+p.join('/'),label:o+' '+p.join('/')};
 }
 function matrixLocation(value){
  const m=/^(.+?)\s+(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/.exec(key(value));
  return m?location([m[1],m[2],m[3],m[4]],{olt:0,frame:1,slot:2,port:3}):null;
 }
 // V-2.43: número válido → atenuada / en rango; OFF → OFF; cualquier otro valor ('-', 0, -255, vacío, texto) → sin medición con su motivo.
 function power(v){
  const s=key(v);if(s.toUpperCase()==='OFF')return {type:'off',signature:'OFF'};
  if(s===''||s==='-')return {type:'missing',signature:'MISSING',reason:'Sin lectura a las 20 h'};
  const n=Number(s.replace(/\u2212/g,'-'));
  if(!/^[+\-\u2212]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)||!Number.isFinite(n))return {type:'missing',signature:'MISSING',reason:'Valor no válido: '+s};
  if(n===-255)return {type:'missing',signature:'MISSING',reason:'Valor −255 (el equipo no pudo medir)'};
  if(n===0)return {type:'missing',signature:'MISSING',reason:'Valor 0 (no es una lectura válida)'};
  return {type:'numeric',value:n,signature:String(n)};
 }
 function coordinate(v){
  const p=key(v).split(',').map(x=>Number(x.trim()));
  // Coordenada capturada como "longitud,latitud": se invierte solo si la latitud es imposible.
  if(p.length===2&&Math.abs(p[0])>90&&Math.abs(p[1])<=90)p.reverse();
  return p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180&&!(p[0]===0&&p[1]===0)?p:null;
 }
 const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

 function create(clientHeaders,powerHeaders,matrixRows){
  const cc=columns(clientHeaders,'clientes'),pc=columns(powerHeaders,'potencias');
  const allowed=new Map(),olts=new Set(),clients=new Map(),powers=new Map();
  const stats={clientsDiscarded:0,clientsCleaned:0,clientsOutside:0,powerDiscarded:0,powerRowsInside:0};
  if(!matrixRows?.length)throw Error('Carga una matriz de puertos válida antes de iniciar el análisis.');
  for(const row of matrixRows){const loc=matrixLocation(typeof row==='string'?row:row.values?.[0]);if(!loc)throw Error('La matriz contiene una ubicación incompleta.');allowed.set(loc.id,loc);olts.add(loc.olt);}

  function client(row){
   const v=row.values,raw=v[cc.account],a=account(raw);
   if(!a){stats.clientsDiscarded++;return;}
   if(hadUnderscore(raw))stats.clientsCleaned++;
   const loc=location(v,cc);if(!loc)throw Error('Archivo de clientes con ubicación incompleta, favor de corregirlo. Fila '+row.excelRow+'.');
   if(clients.has(a))throw Error('Cuenta repetida en la base de clientes: '+a+'. Corrige la base antes de procesar.');
   clients.set(a,{loc,coords:cc.coord<0?null:coordinate(v[cc.coord])});
  }
  function add(row){
   const v=row.values,loc=location(v,pc);
   if(!loc||!allowed.has(loc.id))return;                       // Regla 14
   const a=account(v[pc.account]);if(!a){stats.powerDiscarded++;return;}
   stats.powerRowsInside++;
   const p=power(v[pc.power]),sig=loc.id+'|'+p.signature;         // Regla 11
   let rec=powers.get(a);if(!rec){rec=new Map();powers.set(a,rec);}
   if(!rec.has(sig))rec.set(sig,{loc,power:p,raw:key(v[pc.power]),readings:pc.readings.map(i=>i<0?'':key(v[i])),cluster:pc.cluster<0?'':key(v[pc.cluster]),sn:pc.sn<0?'':key(v[pc.sn]),excelRow:row.excelRow});
  }

  function summary(threshold,percentage,minimum){
   if(![threshold,percentage,minimum].every(Number.isFinite)||percentage<=0||percentage>100||minimum<1)throw Error('Parámetros de análisis inválidos.');
   const T=threshold,ports=new Map(),clusterCount=new Map(),accounts=[],conflicts=[];
   const edges=[T-9,T-6,T-3,T,T+3,T+6],bins=Array(7).fill(0);
   const totals={accounts:0,low:0,good:0,off:0,missing:0,duplicates:0,noCoords:0,clients:clients.size,...stats};
   let index=0;
   for(const loc of allowed.values())ports.set(loc.id,{...loc,i:index++,cluster:'',low:0,good:0,off:0,missing:0,dup:0,clients:0,values:[],lats:[],lons:[]});
   const tally=(p,cluster)=>{if(!cluster)return;let m=clusterCount.get(p.id);if(!m){m=new Map();clusterCount.set(p.id,m);}m.set(cluster,(m.get(cluster)||0)+1);};
   const push=(a,p,s,v,extra)=>{const c=clients.get(a)?.coords;accounts.push({a,p:p.i,s,v:v??null,lat:c?c[0]:null,lon:c?c[1]:null,...extra});};

   for(const [a,rec] of powers){
    const vv=[...rec.values()];let r=null;
    if(vv.length===1)r=vv[0];
    if(!r){                                                                                      // Regla 13
     totals.duplicates++;const ids=new Set(vv.map(x=>x.loc.id));
     const cc=clients.get(a)?.coords;   // V-2.46: coordenadas para el Excel del puerto
     conflicts.push({account:a,reason:ids.size>1?'Puerto diferente':'Potencia diferente',lat:cc?cc[0]:null,lon:cc?cc[1]:null,records:vv.map(x=>({label:x.loc.label,raw:x.raw,sn:x.sn,excelRow:x.excelRow}))});
     for(const id of ids){const p=ports.get(id);p.dup++;}
     for(const x of vv)tally(ports.get(x.loc.id),x.cluster);
     continue;
    }
    const p=ports.get(r.loc.id);tally(p,r.cluster);
    // V-2.45: las 6 lecturas (RX_00h…RX_20h) como número o null, para la gráfica de comportamiento del puerto.
    const h=r.readings.map(x=>{const q=power(x);return q.type==='numeric'?q.value:null;});
    if(r.power.type==='numeric'){const n=r.power.value;p.values.push(n);
     const b=n<=edges[0]?0:n<=edges[1]?1:n<=edges[2]?2:n<=edges[3]?3:n<=edges[4]?4:n<=edges[5]?5:6;bins[b]++;
     if(n<=T){p.low++;totals.low++;push(a,p,'low',n,{h});}else{p.good++;totals.good++;push(a,p,'ok',n,{h});}}   // Regla 2
    else if(r.power.type==='off'){p.off++;totals.off++;push(a,p,'off',null,{h});}
    else{p.missing++;totals.missing++;push(a,p,'miss',null,{why:r.power.reason,r:r.readings,h});}
   }
   const noCoordList=[];   // V-2.46: cuentas sin coordenadas para exportar (mismo universo que el indicador)
   for(const [a,c] of clients){
    if(!c.coords){totals.noCoords++;noCoordList.push({a,label:c.loc.label});}
    const p=ports.get(c.loc.id);
    if(!p){totals.clientsOutside++;continue;}
    p.clients++;if(c.coords){p.lats.push(c.coords[0]);p.lons.push(c.coords[1]);}
    if(!powers.has(a)){p.missing++;totals.missing++;push(a,p,'miss',null,{why:'No viene en la base de potencias',r:null});}   // Regla 8
   }
   const list=[...ports.values()].map(p=>{
    const measured=p.low+p.good,pct=measured?100*p.low/measured:0;                              // Regla 3
    const state=!measured?'nomeasure':pct>=percentage?(p.low>=minimum?'alert':'drops'):'below'; // Reglas 4 a 7
    const cl=clusterCount.get(p.id);let cluster='';if(cl){let best=0;for(const [k,n] of cl)if(n>best){best=n;cluster=k;}}
    const s=p.values.length?[...p.values].sort((x,y)=>x-y):[];
    return {id:p.id,i:p.i,label:p.label,olt:p.olt,frame:p.frame,slot:p.slot,port:p.port,cluster,low:p.low,good:p.good,off:p.off,missing:p.missing,dup:p.dup,
     measured,total:measured+p.off+p.missing+p.dup,percentage:pct,state,
     median:median(s),worst:s.length?s[0]:null,best:s.length?s[s.length-1]:null,lat:median(p.lats),lon:median(p.lons),
     // Ubicación aproximada: menos de 5 clientes con coordenadas o menos de la cuarta parte de sus clientes.
     located:p.lats.length,clients:p.clients,approx:p.lats.length>0&&(p.lats.length<5||p.lats.length<p.clients/4)};
   });
   totals.accounts=accounts.length+totals.duplicates;
   const labels=['≤ '+edges[0],edges[0]+' a '+edges[1],edges[1]+' a '+edges[2],edges[2]+' a '+edges[3],edges[3]+' a '+edges[4],edges[4]+' a '+edges[5],'> '+edges[5]];
   return {totals,ports:list,accounts,conflicts,noCoordList,bins,binLabels:labels.map(x=>x.replace(/-/g,'−')),lowBins:4,olts:[...olts].sort(),threshold:T,percentage,minimum};
  }
  return {client,add,summary};
 }
 return {cut,columns,location,matrixLocation,power,coordinate,create,key,account};
}
