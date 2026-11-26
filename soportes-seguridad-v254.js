/* Soportes V-2.54 · Cifrado de sus bases y control de acceso (mismo esquema que Planta Externa V-2.53).
   - Solo actúa en la pestaña de Soportes (index.html?tool=soporte). La contraseña del día se escribe en la Bienvenida.
   - Bases: soportes, importaciones, red (cuenta → PON) y polígonos Clean Up. Antes en IndexedDB sin cifrar
     ('primavera_soportes_v12', 'primavera_cleanup_v46'); ahora cifradas (AES-256-GCM) en 'primavera-soportes-cifrado-v1'.
   - La primera vez, lo que ya estaba guardado se cifra y se muda solo; las copias sin cifrar se vacían.
   - Soportes y Clean Up siguen usando sus mismas funciones de almacenamiento: SO254.abrir() les entrega un almacén
     con la misma forma (transaction / objectStore / getAll / get / put / delete / clear) que guarda cifrado. No cambia ningún cálculo. */
(()=>{'use strict';
if(new URLSearchParams(location.search).get('tool')!=='soporte'){   // Bienvenida: Soportes no abre sus bases aquí
 window.SO254=Object.freeze({listo:new Promise(()=>{}),ocupado(){},abrir:()=>new Promise(()=>{})});return;}
const S=PrimaveraSesion,C=at250Cripto(),MODULO='soportes',DB='primavera-soportes-cifrado-v1',STORE='datos';
const LEGADOS={primavera_soportes_v12:{events:'key',imports:'id',network:'cuenta',network_meta:'id'},primavera_cleanup_v46:{polygons:'id'}};
const {ABRE,CIERRA,INACTIVO,AVISO}=S;
let key=null,fecha=null,maestra=null,ocupado=0,base=0,ultimo=0,ultimaPared=0,cerrando=false,timer=null,listoOk,horario=null,llaves=null,hoy=null;
const listo=new Promise(r=>{listoOk=r;});
const mem=new Map();   // 'db/store' → Map(llave → registro)
const PASE=S.pase();
const ahora=()=>base+performance.now(),mx=S.mx;
async function horaServidor(){const t0=performance.now();const r=await fetch('horario.json?t='+Date.now(),{cache:'no-store'});const d=r.headers.get('Date');if(!r.ok||!d)throw Error('sin hora');const ms=Date.parse(d);if(!Number.isFinite(ms))throw Error('sin hora');base=ms-(t0+performance.now())/2;ultimaPared=Date.now();return r.json();}

/* ---------- Cifrado ---------- */
async function cerrarCon(k,valor){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,C.te.encode(JSON.stringify(valor)));return {so254:1,m:maestra,k:fecha,iv,ct};}
async function abrirCon(k,rec){return JSON.parse(C.td.decode(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:rec.iv},k,rec.ct))));}

/* ---------- IndexedDB real ---------- */
const req=r=>new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error);});
const crear=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'kind'});};
async function abrirDb(){const d=await req(Object.assign(indexedDB.open(DB),{onupgradeneeded:crear}));if(d.objectStoreNames.contains(STORE))return d;const v=d.version+1;d.close();return req(Object.assign(indexedDB.open(DB,v),{onupgradeneeded:crear}));}
function txReal(db,modo,fn){return new Promise((a,b)=>{const t=db.transaction(STORE,modo);const s=t.objectStore(STORE);const out=fn(s);t.oncomplete=()=>a(out&&out.result);t.onerror=()=>b(t.error);t.onabort=()=>b(t.error||Error('Almacenamiento interrumpido'));});}
async function existe(nombre){try{return (await indexedDB.databases()).some(x=>x.name===nombre);}catch{return false;}}

/* ---------- Mudanza (sin cifrar → cifrado), recifrado diario y limpieza por cambio de llave maestra ---------- */
async function preparar(dia,modKey){
 const db=await abrirDb();const avisos=new Set();
 try{
  const atras=llaves.dias[hoy].atras||{},viejas={};
  const llaveDe=async k=>{if(k===hoy)return modKey;if(viejas[k])return viejas[k];const a=atras[k];if(!a)return null;
   const diaKey=await C.aesKey(dia);const v=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:C.unb64(a.iv)},diaKey,C.unb64(a.ct)));viejas[k]=await C.moduloKey(v,MODULO);v.fill(0);return viejas[k];};
  const guardados=await txReal(db,'readonly',s=>s.getAll());
  const escribir={};
  for(const rec of guardados||[]){const [dbn,st]=rec.kind.split('/');const kp=LEGADOS[dbn]?.[st];if(!kp)continue;
   if(rec.m!==llaves.maestra){avisos.add('El administrador cambió la llave maestra. Por seguridad se borraron las bases de Soportes guardadas. Vuelve a cargarlas.');escribir[rec.kind]=null;continue;}
   const k=await llaveDe(rec.k);
   if(!k){avisos.add('Las bases de Soportes se cifraron hace más de 30 días y ya no se pueden abrir. Por seguridad se borraron. Vuelve a cargarlas.');escribir[rec.kind]=null;continue;}
   const filas=await abrirCon(k,rec);mem.set(rec.kind,ordenar(new Map(filas.map(x=>[x[kp],x]))));
   if(rec.k!==hoy)escribir[rec.kind]=filas;}
  // Mudanza de las bases sin cifrar
  for(const [dbn,stores] of Object.entries(LEGADOS)){if(!(await existe(dbn)))continue;
   const vieja=await req(indexedDB.open(dbn));
   try{for(const [st,kp] of Object.entries(stores)){if(!vieja.objectStoreNames.contains(st))continue;const kind=dbn+'/'+st;
     const filas=await new Promise((a,b)=>{const g=vieja.transaction(st).objectStore(st).getAll();g.onsuccess=()=>a(g.result);g.onerror=()=>b(g.error);});
     if(filas.length&&!mem.has(kind)){mem.set(kind,ordenar(new Map(filas.map(x=>[x[kp],x]))));escribir[kind]=filas;}}
    // Se guarda cifrado primero y después se vacía la copia sin cifrar.
    await guardar(db,modKey,escribir);for(const k of Object.keys(escribir))delete escribir[k];
    const sts=Object.keys(stores).filter(st=>vieja.objectStoreNames.contains(st));
    if(sts.length)await new Promise((a,b)=>{const t=vieja.transaction(sts,'readwrite');sts.forEach(st=>t.objectStore(st).clear());t.oncomplete=a;t.onerror=()=>b(t.error);});
   }finally{vieja.close();}}
  await guardar(db,modKey,escribir);
 }finally{db.close();}
 return [...avisos];
}
// escribe (o borra con null) varios almacenes en UNA transacción
async function guardar(db,k,cambios){const kinds=Object.keys(cambios);if(!kinds.length)return;
 const recs={};for(const kind of kinds)recs[kind]=cambios[kind]===null?null:{kind,...await cerrarCon(k,cambios[kind])};
 await txReal(db,'readwrite',s=>{for(const kind of kinds)recs[kind]?s.put(recs[kind]):s.delete(kind);});}

/* ---------- Almacén con la forma de IndexedDB que guarda cifrado (lo usan Soportes y Clean Up) ---------- */
let cola=Promise.resolve();
// Igual que IndexedDB: los registros se entregan ordenados por su llave (indexedDB.cmp).
const ordenados=new WeakSet();
function ordenar(m){if(ordenados.has(m))return m;const o=new Map([...m.entries()].sort((a,b)=>indexedDB.cmp(a[0],b[0])));ordenados.add(o);return o;}
const copia=v=>structuredClone(v);
function almacen(dbn,stores){
 const evento=(t,tipo)=>{const f=t['on'+tipo];if(typeof f==='function')try{f.call(t,{type:tipo,target:t});}catch(e){setTimeout(()=>{throw e;});}};
 function transaction(nombres,modo='readonly'){nombres=[].concat(nombres);for(const n of nombres)if(!(n in stores))throw new DOMException('No existe el almacén '+n,'NotFoundError');
  const ops=[];let activo=true;const tx={error:null,mode:modo,oncomplete:null,onerror:null,onabort:null,
   objectStore(n){if(!nombres.includes(n))throw new DOMException('Almacén fuera de la transacción','NotFoundError');const kind=dbn+'/'+n,kp=stores[n];
    const pedido=(tipo,arg)=>{if(!activo)throw new DOMException('La transacción ya terminó','TransactionInactiveError');const r={result:undefined,error:null,onsuccess:null,onerror:null,readyState:'pending'};ops.push({tipo,kind,kp,arg,r});return r;};
    const escritura=tipo=>{if(modo!=='readwrite')throw new DOMException('Transacción de solo lectura','ReadOnlyError');};
    return {name:n,keyPath:kp,
     getAll(){return pedido('getAll');},get(k){return pedido('get',k);},count(){return pedido('count');},
     put(x){escritura();return pedido('put',copia(x));},add(x){escritura();return pedido('put',copia(x));},
     delete(k){escritura();return pedido('delete',k);},clear(){escritura();return pedido('clear');}};}};
  cola=cola.then(()=>new Promise(r=>setTimeout(r,0))).then(async()=>{
   activo=false;const etapa=new Map();const ver=kind=>etapa.get(kind)||mem.get(kind)||new Map();
   const editar=kind=>{if(!etapa.has(kind))etapa.set(kind,new Map(mem.get(kind)||[]));return etapa.get(kind);};
   try{if(!key)throw Error('La sesión de Soportes está cerrada.');
    for(let i=0;i<ops.length;i++){const o=ops[i];let res;
     if(o.tipo==='getAll')res=copia([...ordenar(ver(o.kind)).values()]);
     else if(o.tipo==='get'){const v=ver(o.kind).get(o.arg);res=v===undefined?undefined:copia(v);}
     else if(o.tipo==='count')res=ver(o.kind).size;
     else if(o.tipo==='put'){const k=o.arg?.[o.kp];if(k===undefined||k===null)throw new DOMException('Registro sin llave','DataError');editar(o.kind).set(k,o.arg);res=k;}
     else if(o.tipo==='delete')editar(o.kind).delete(o.arg);
     else if(o.tipo==='clear')editar(o.kind).clear();
     o.r.result=res;o.r.readyState='done';evento(o.r,'success');}
    if(etapa.size){PS.ocupado(true);try{const db=await abrirDb();try{const cambios={};for(const [kind,m] of etapa)cambios[kind]=[...m.values()];await guardar(db,key,cambios);}finally{db.close();}}finally{PS.ocupado(false);}
     for(const [kind,m] of etapa)mem.set(kind,ordenar(m));}
    evento(tx,'complete');
   }catch(err){tx.error=err;evento(tx,'error');evento(tx,'abort');}
  });
  return tx;}
 return {name:dbn,objectStoreNames:{contains:n=>n in stores},transaction,close(){}};
}

/* ---------- Pantalla de acceso (mismos estilos que Planta: sesion-v253.css) ---------- */
const gate=document.createElement('div');gate.id='pe253-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','pe253-title');
gate.innerHTML='<div class="ps-card"><h2 id="pe253-title">Soportes · Acceso</h2><p id="pe253-text">Verificando acceso…</p><p id="pe253-msg" role="alert"></p><a href="index.html" class="ps-back">Volver a la Bienvenida</a></div>';
document.documentElement.classList.add('pe253-locked');
if(!PASE){location.replace('index.html');}
const $=id=>document.getElementById(id);
async function entrar(){
 let ses=null;try{ses=await S.pedir(PASE,MODULO);}catch{}
 if(!ses){$('pe253-text').textContent='La sesión no está abierta. Abre Soportes desde la Bienvenida y escribe ahí la contraseña del día.';return;}
 let dia=ses.dia;const tirar=()=>{if(dia){dia.fill(0);dia=null;}};
 try{horario=await horaServidor();}catch{tirar();$('pe253-text').textContent='No se pudo verificar la hora del servidor. Abre la herramienta desde la página publicada y con internet o VPN.';return;}
 const t=mx(ahora());hoy=t.fecha;
 if(t.h<ABRE||t.h>=CIERRA||ses.fecha!==hoy||!horario||horario.fecha!==hoy||!horario.h){tirar();$('pe253-text').textContent='Fuera de horario o cambió el día. Vuelve a la Bienvenida.';return;}
 try{llaves=await S.llaves();}catch{tirar();$('pe253-text').textContent='No se encontró el archivo de llaves. Contacta al administrador.';return;}
 if(!llaves.dias?.[hoy]){tirar();$('pe253-text').textContent='Contraseñas vencidas. Contacta al administrador.';return;}
 $('pe253-text').textContent='Abriendo Soportes…';
 try{const modKey=await C.moduloKey(dia,MODULO);fecha=hoy;maestra=llaves.maestra;
  const avisos=await preparar(dia,modKey);tirar();key=modKey;
  gate.remove();document.documentElement.classList.remove('pe253-locked');ultimo=performance.now();iniciarRelojes();listoOk();
  window.dispatchEvent(new Event('resize'));
  if(avisos.length)setTimeout(()=>aviso(avisos.join('\n\n')),300);
 }catch(err){tirar();$('pe253-msg').textContent='No se pudo preparar el almacenamiento cifrado: '+err.message;}
}
function aviso(t){const d=document.createElement('dialog');d.className='msg-dialog';d.innerHTML='<h2>Soportes · Seguridad</h2><p style="white-space:pre-line"></p><button type="button">Aceptar</button>';d.querySelector('p').textContent=t;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();}
if(PASE){const mount=()=>{document.body.append(gate);entrar();};document.body?mount():document.addEventListener('DOMContentLoaded',mount);}

/* ---------- Inactividad (5 min) y cierre a las 20:00 (igual que Planta y Atenuados) ---------- */
const banner=document.createElement('div');banner.id='pe253-banner';banner.setAttribute('role','alertdialog');banner.hidden=true;banner.innerHTML='<p id="pe253-btext"></p><button type="button" id="pe253-seguir">Seguir trabajando</button>';
['pointermove','pointerdown','keydown','wheel','touchstart','scroll'].forEach(ev=>window.addEventListener(ev,()=>{if(key&&!cerrando){ultimo=performance.now();S.ping();if(banner.dataset.tipo==='inactividad')banner.hidden=true;}},{passive:true,capture:true}));
function iniciarRelojes(){document.body.append(banner);$('pe253-seguir').onclick=()=>{ultimo=performance.now();banner.hidden=true;};
 timer=setInterval(async()=>{if(!key||cerrando)return;
  const pared=Date.now(),salto=Math.abs(pared-ultimaPared-1000);ultimaPared=pared;
  if(salto>90000){if(salto>=INACTIVO&&!ocupado){bloquear();return;}
   try{const hz=await horaServidor();if(!hz||!hz.h||hz.fecha!==fecha){bloquear();return;}}catch{bloquear();return;}}
  const t=mx(ahora());
  if(t.fecha!==fecha||t.h>=CIERRA){if(ocupado){mostrar('horario','Son las 20:00. La herramienta se cerrará al terminar el proceso en curso.');return;}bloquear();return;}
  if(t.h===CIERRA-1&&t.m>=55)mostrar('horario','La herramienta se cerrará a las 20:00. Guarda o exporta lo que necesites.');
  if(ocupado){ultimo=performance.now();return;}
  const idle=performance.now()-ultimo;
  if(idle>=INACTIVO){bloquear();return;}
  if(idle>=AVISO)mostrar('inactividad',`El módulo se cerrará en ${Math.max(0,Math.ceil((INACTIVO-idle)/1000))} segundos por inactividad.`);
 },1000);}
function mostrar(tipo,t){if(tipo==='inactividad'&&banner.dataset.tipo==='horario'&&!banner.hidden)return;banner.dataset.tipo=tipo;$('pe253-btext').textContent=t;$('pe253-seguir').hidden=tipo!=='inactividad';banner.hidden=false;}
function bloquear(){if(cerrando)return;cerrando=true;key=null;clearInterval(timer);mem.clear();
 document.documentElement.classList.add('pe253-locked');document.body.replaceChildren();
 try{window.close();}catch{}setTimeout(()=>location.replace('index.html'),400);}

/* ---------- API ---------- */
const PS={ocupado(on){ocupado=Math.max(0,ocupado+(on?1:-1));if(!on)ultimo=performance.now();}};
window.SO254=Object.freeze({
 listo,
 ocupado:PS.ocupado,
 async abrir(dbn,stores){await listo;return almacen(dbn,stores);}
});
})();
