/* Planta Externa V-2.56 (igual que V-2.53 + red de Mtto Preventivo cifrada y recifrada a diario) · Cifrado del histórico de masivos y de las coberturas, y control de acceso.
   - La contraseña del día se escribe en la Bienvenida; Planta recibe el material del día con un pase de un solo uso.
   - Histórico de masivos: antes en localStorage ('primavera_masivos_v1'); ahora cifrado (AES-256-GCM) en IndexedDB
     'primavera-planta-bases-v1'. Coberturas: misma base 'primavera_coverage_v55', con el valor cifrado.
   - La primera vez, lo que ya estaba guardado sin cifrar se cifra y se muda solo; la copia sin cifrar se borra.
   - Recifrado diario, horario 09:00–20:00 con hora del servidor, cierre por 5 min sin uso. No cambia ningún cálculo. */
(()=>{'use strict';
const S=PrimaveraSesion,C=at250Cripto(),MODULO='planta',DB='primavera-planta-bases-v1',STORE='datos';
const LEGADO='primavera_masivos_v1',COB_DB='primavera_coverage_v55',COB_STORE='coverage',COB_KEY='current';
const {ABRE,CIERRA,INACTIVO,AVISO}=S;
let key=null,fecha=null,maestra=null,ocupado=0,base=0,ultimo=0,ultimaPared=0,cerrando=false,timer=null,listoOk,horario=null,llaves=null,hoy=null;
const listo=new Promise(r=>{listoOk=r;});
const PASE=S.pase();
const ahora=()=>base+performance.now(),mx=S.mx;
async function horaServidor(){const t0=performance.now();const r=await fetch('horario.json?t='+Date.now(),{cache:'no-store'});const d=r.headers.get('Date');if(!r.ok||!d)throw Error('sin hora');const ms=Date.parse(d);if(!Number.isFinite(ms))throw Error('sin hora');base=ms-(t0+performance.now())/2;ultimaPared=Date.now();return r.json();}

/* ---------- Cifrado de valores JSON ---------- */
async function cerrarCon(k,valor){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,C.te.encode(JSON.stringify(valor)));return {pe253:1,m:maestra,k:fecha,iv,ct};}
async function abrirCon(k,rec){return JSON.parse(C.td.decode(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:rec.iv},k,rec.ct))));}
const cifrado=v=>!!(v&&v.pe253===1&&v.ct);

/* ---------- IndexedDB ---------- */
const req=r=>new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error);});
const crear=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'kind'});};
async function abrirDb(){const d=await req(Object.assign(indexedDB.open(DB),{onupgradeneeded:crear}));if(d.objectStoreNames.contains(STORE))return d;const v=d.version+1;d.close();return req(Object.assign(indexedDB.open(DB,v),{onupgradeneeded:crear}));}
const abrirCob=()=>req(Object.assign(indexedDB.open(COB_DB,1),{onupgradeneeded:e=>{const d=e.target.result;if(!d.objectStoreNames.contains(COB_STORE))d.createObjectStore(COB_STORE);}}));
async function tx(db,store,modo,fn){return new Promise((a,b)=>{const t=db.transaction(store,modo);const r=fn(t.objectStore(store));let out;if(r)r.onsuccess=()=>{out=r.result;};t.oncomplete=()=>a(out);t.onerror=()=>b(t.error);t.onabort=()=>b(t.error||Error('Almacenamiento interrumpido'));});}
async function leerMasivos(db){return tx(db,STORE,'readonly',s=>s.get('masivos'));}
async function escribirMasivos(db,rec){return tx(db,STORE,'readwrite',s=>s.put({kind:'masivos',...rec}));}
async function leerCob(db){return tx(db,COB_STORE,'readonly',s=>s.get(COB_KEY));}
async function escribirCob(db,v){return tx(db,COB_STORE,'readwrite',s=>s.put(v,COB_KEY));}
async function borrarCob(db){return tx(db,COB_STORE,'readwrite',s=>s.delete(COB_KEY));}

/* ---------- Mudanza (sin cifrar → cifrado), recifrado diario y limpieza por cambio de llave maestra ---------- */
async function preparar(dia,modKey){
 const db=await abrirDb(),cob=await abrirCob();const avisos=[];
 try{
  const atras=llaves.dias[hoy].atras||{},llavesViejas={};
  const llaveDe=async k=>{if(k===hoy)return modKey;if(llavesViejas[k])return llavesViejas[k];const a=atras[k];if(!a)return null;
   const diaKey=await C.aesKey(dia);const vieja=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:C.unb64(a.iv)},diaKey,C.unb64(a.ct)));llavesViejas[k]=await C.moduloKey(vieja,MODULO);vieja.fill(0);return llavesViejas[k];};
  // Histórico de masivos
  let rec=await leerMasivos(db);
  if(rec&&rec.m!==llaves.maestra){await tx(db,STORE,'readwrite',s=>s.delete('masivos'));rec=null;avisos.push('El administrador cambió la llave maestra. Por seguridad se borró el histórico de masivos guardado. Vuelve a cargarlo.');}
  if(rec&&rec.k!==hoy){const k=await llaveDe(rec.k);
   if(!k){await tx(db,STORE,'readwrite',s=>s.delete('masivos'));rec=null;avisos.push('El histórico de masivos se cifró hace más de 30 días y ya no se puede abrir. Por seguridad se borró. Vuelve a cargarlo.');}
   else{const datos=await abrirCon(k,rec);await escribirMasivos(db,await cerrarCon(modKey,datos));}}
  let legado=null;try{legado=localStorage.getItem(LEGADO);}catch{}
  if(legado!==null){let datos=null;try{datos=JSON.parse(legado);}catch{}
   if(Array.isArray(datos)){const actual=await leerMasivos(db);
    if(!actual)await escribirMasivos(db,await cerrarCon(modKey,datos));}   // si ya hay histórico cifrado, ese manda
   try{localStorage.removeItem(LEGADO);}catch{}}
  // V-2.56 · Mtto Preventivo (red de brazos): mismo almacén cifrado, registro 'preventivo'
  let pv=await tx(db,STORE,'readonly',s=>s.get('preventivo'));
  if(pv&&pv.m!==llaves.maestra){await tx(db,STORE,'readwrite',s=>s.delete('preventivo'));pv=null;avisos.push('El administrador cambió la llave maestra. Por seguridad se borró la red de Mtto Preventivo guardada. Vuelve a cargarla.');}
  if(pv&&pv.k!==hoy){const k=await llaveDe(pv.k);
   if(!k){await tx(db,STORE,'readwrite',s=>s.delete('preventivo'));avisos.push('La red de Mtto Preventivo se cifró hace más de 30 días y ya no se puede abrir. Por seguridad se borró. Vuelve a cargarla.');}
   else{const datos=await abrirCon(k,pv);const rec=await cerrarCon(modKey,datos);await tx(db,STORE,'readwrite',s=>s.put({kind:'preventivo',...rec}));}}
  // Coberturas
  let v=await leerCob(cob);
  if(v&&cifrado(v)&&v.m!==llaves.maestra){await borrarCob(cob);v=null;avisos.push('El administrador cambió la llave maestra. Por seguridad se borraron las coberturas guardadas. Vuelve a cargarlas.');}
  if(v&&cifrado(v)&&v.k!==hoy){const k=await llaveDe(v.k);
   if(!k){await borrarCob(cob);avisos.push('Las coberturas se cifraron hace más de 30 días y ya no se pueden abrir. Por seguridad se borraron. Vuelve a cargarlas.');}
   else await escribirCob(cob,await cerrarCon(modKey,await abrirCon(k,v)));}
  else if(v&&!cifrado(v))await escribirCob(cob,await cerrarCon(modKey,v));   // mudanza de coberturas sin cifrar
 }finally{db.close();cob.close();}
 return avisos;
}

/* ---------- Pantalla de acceso ---------- */
const gate=document.createElement('div');gate.id='pe253-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','pe253-title');
gate.innerHTML='<div class="ps-card"><h2 id="pe253-title">Planta Externa · Acceso</h2><p id="pe253-text">Verificando acceso…</p><p id="pe253-msg" role="alert"></p><a href="index.html" class="ps-back">Volver a la Bienvenida</a></div>';
document.documentElement.classList.add('pe253-locked');
if(!PASE){location.replace('index.html');}
const $=id=>document.getElementById(id);
async function entrar(){
 let ses=null;try{ses=await S.pedir(PASE,MODULO);}catch{}
 if(!ses){$('pe253-text').textContent='La sesión no está abierta. Abre Planta Externa desde la Bienvenida y escribe ahí la contraseña del día.';return;}
 let dia=ses.dia;const tirar=()=>{if(dia){dia.fill(0);dia=null;}};
 try{horario=await horaServidor();}catch{tirar();$('pe253-text').textContent='No se pudo verificar la hora del servidor. Abre la herramienta desde la página publicada y con internet o VPN.';return;}
 const t=mx(ahora());hoy=t.fecha;
 if(t.h<ABRE||t.h>=CIERRA||ses.fecha!==hoy||!horario||horario.fecha!==hoy||!horario.h){tirar();$('pe253-text').textContent='Fuera de horario o cambió el día. Vuelve a la Bienvenida.';return;}
 try{llaves=await S.llaves();}catch{tirar();$('pe253-text').textContent='No se encontró el archivo de llaves. Contacta al administrador.';return;}
 if(!llaves.dias?.[hoy]){tirar();$('pe253-text').textContent='Contraseñas vencidas. Contacta al administrador.';return;}
 $('pe253-text').textContent='Abriendo Planta Externa…';
 try{const modKey=await C.moduloKey(dia,MODULO);fecha=hoy;maestra=llaves.maestra;
  const avisos=await preparar(dia,modKey);tirar();key=modKey;
  gate.remove();document.documentElement.classList.remove('pe253-locked');ultimo=performance.now();iniciarRelojes();listoOk(key);
  if(avisos.length)setTimeout(()=>aviso(avisos.join('\n\n')),300);
 }catch(err){tirar();$('pe253-msg').textContent='No se pudo preparar el almacenamiento cifrado: '+err.message;}
}
function aviso(t){const d=document.createElement('dialog');d.className='msg-dialog';d.innerHTML='<h2>Planta Externa · Seguridad</h2><p style="white-space:pre-line"></p><button type="button">Aceptar</button>';d.querySelector('p').textContent=t;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();}
if(PASE){const mount=()=>{document.body.append(gate);entrar();};document.body?mount():document.addEventListener('DOMContentLoaded',mount);}

/* ---------- Inactividad (5 min) y cierre a las 20:00 (mismo comportamiento que Atenuados) ---------- */
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
function bloquear(){if(cerrando)return;cerrando=true;key=null;clearInterval(timer);
 document.documentElement.classList.add('pe253-locked');document.body.replaceChildren();
 try{window.close();}catch{}setTimeout(()=>location.replace('index.html'),400);}

/* ---------- API para plant-app y coberturas (solo esperan la llave; no cambian sus cálculos) ---------- */
window.PE253=Object.freeze({
 listo,
 ocupado(on){ocupado=Math.max(0,ocupado+(on?1:-1));if(!on)ultimo=performance.now();},
 async cargarMasivos(){const k=await listo;const db=await abrirDb();try{const r=await leerMasivos(db);if(!r)return [];const v=await abrirCon(k,r);return Array.isArray(v)?v:[];}finally{db.close();}},
 async guardarMasivos(lista){const k=await listo;const rec=await cerrarCon(k,lista);rec.n=lista.length;const db=await abrirDb();try{await escribirMasivos(db,rec);}finally{db.close();}},
 async borrarMasivos(){await listo;const db=await abrirDb();try{await tx(db,STORE,'readwrite',s=>s.delete('masivos'));}finally{db.close();}},
 async cerrarCobertura(valor){const k=await listo;return cerrarCon(k,valor);},
 async abrirCobertura(v){const k=await listo;if(!v)return v;return cifrado(v)?abrirCon(k,v):v;},
 // V-2.56 · Mtto Preventivo
 async cargarPreventivo(){const k=await listo;const db=await abrirDb();try{const r=await tx(db,STORE,'readonly',s=>s.get('preventivo'));return r?await abrirCon(k,r):null;}finally{db.close();}},
 async guardarPreventivo(v){const k=await listo;const rec=await cerrarCon(k,v);const db=await abrirDb();try{await tx(db,STORE,'readwrite',s=>s.put({kind:'preventivo',...rec}));}finally{db.close();}}
});
})();
