/* Atenuados V-2.53 · Cifrado de bases y control de acceso (desde V-2.53 la contraseña se escribe una sola vez en la Bienvenida).
   - Bases cifradas con AES-256-GCM. La llave del día sale de la contraseña diaria (PBKDF2-SHA256, 600,000 rondas)
     combinada con la llave de horario que GitHub publica solo de 09:00 a 20:00 (HKDF-SHA256).
   - Hora tomada del servidor (cabecera Date), no del reloj de la laptop.
   - Recifrado diario: la primera apertura del día vuelve a cifrar todo con la llave del día.
   - Cierre por 5 min de inactividad y a las 20:00. Entrada solo desde la Bienvenida.
   Solo funciones del navegador (Web Crypto). No toca la lógica de análisis. */

// at250Cripto() vive en seguridad-v253.js (mismo código), que se carga antes que este archivo.

(()=>{'use strict';
if(typeof window==='undefined'||!window.document)return;
const MODULO='atenuados',DB='primavera-atenuados-bases-v1',INACTIVO=300000,AVISO=270000,ABRE=9,CIERRA=20,ENTRADA='primavera-entrada-atenuados',INTENTOS='primavera-intentos-atenuados';
const C=at250Cripto(),S=PrimaveraSesion;
// ---------- 1. Entrada solo desde la Bienvenida: pase de un solo uso emitido por la sesión de la Bienvenida ----------
const PASE=S.pase();
if(!PASE){document.documentElement.classList.add('at250-locked');location.replace('index.html');return;}
try{localStorage.removeItem(ENTRADA);}catch{}

let key=null,fecha=null,maestra=null,ocupado=0,base=0,reloj=0,ultimo=0,ultimaPared=0,cerrando=false,timer=null;
const ahora=()=>base+performance.now();
const mx=ms=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return {fecha:`${p.year}-${p.month}-${p.day}`,h:+p.hour,m:+p.minute,s:+p.second};};
async function horaServidor(){const t0=performance.now();const r=await fetch('horario.json?t='+Date.now(),{cache:'no-store'});const d=r.headers.get('Date');if(!r.ok||!d)throw Error('sin hora');const ms=Date.parse(d);if(!Number.isFinite(ms))throw Error('sin hora');base=ms-(t0+performance.now())/2;ultimaPared=Date.now();return r.json();}

// ---------- 2. Pantalla de acceso ----------
const gate=document.createElement('div');gate.id='at250-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','at250-title');
gate.innerHTML='<div class="at250-card"><h2 id="at250-title">Atenuados · Acceso</h2><p id="at250-text">Verificando acceso…</p><p id="at250-msg" role="alert"></p><div class="at250-bar" hidden><span id="at250-fill"></span></div><a href="index.html" class="at250-back">Volver a la Bienvenida</a></div>';
document.documentElement.classList.add('at250-locked');
const mount=()=>{document.body.append(gate);preparar();};document.body?mount():document.addEventListener('DOMContentLoaded',mount);
const $=id=>document.getElementById(id);
const msg=(t,err=true)=>{const m=$('at250-msg');m.textContent=t;m.classList.toggle('ok',!err);};
let horario=null,llaves=null,hoy=null;
async function preparar(){
 let ses=null;try{ses=await S.pedir(PASE,MODULO);}catch{}
 if(!ses){$('at250-text').textContent='La sesión no está abierta. Abre Atenuados desde la Bienvenida y escribe ahí la contraseña del día.';return;}
 let dia=ses.dia;const tirar=()=>{if(dia){dia.fill(0);dia=null;}};
 try{horario=await horaServidor();}catch{tirar();$('at250-text').textContent='No se pudo verificar la hora del servidor. Abre la herramienta desde la página publicada y con internet o VPN.';return;}
 const t=mx(ahora());hoy=t.fecha;
 if(t.h<ABRE||t.h>=CIERRA||ses.fecha!==hoy||!horario||horario.fecha!==hoy||!horario.h){tirar();$('at250-text').textContent='Fuera de horario o cambió el día. Vuelve a la Bienvenida.';return;}
 try{const r=await fetch('llaves.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw 0;llaves=await r.json();}catch{tirar();$('at250-text').textContent='No se encontró el archivo de llaves. Contacta al administrador.';return;}
 if(!llaves.dias?.[hoy]){tirar();$('at250-text').textContent='Contraseñas vencidas. Contacta al administrador.';return;}
 $('at250-text').textContent='Abriendo Atenuados…';
 try{
  const modKey=await C.moduloKey(dia,MODULO);
  await recifrar(dia,modKey);tirar();
  key=modKey;fecha=hoy;maestra=llaves.maestra;
  gate.remove();document.documentElement.classList.remove('at250-locked');
  ultimo=performance.now();iniciarRelojes();window.dispatchEvent(new CustomEvent('at250-desbloqueado'));
 }catch(err){tirar();msg('No se pudieron preparar las bases: '+err.message);}
}

// ---------- 3. Recifrado diario y limpieza de bases sin cifrar o con otra llave maestra ----------
const req=r=>new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error);});
async function borrarTodo(db){await new Promise((a,b)=>{const t=db.transaction(['meta','chunks'],'readwrite');t.objectStore('meta').clear();t.objectStore('chunks').clear();t.oncomplete=a;t.onerror=()=>b(t.error);});}
async function recifrar(dia,modKey){
 const db=await req(Object.assign(indexedDB.open(DB,1),{onupgradeneeded:e=>{const d=e.target.result;d.createObjectStore('meta',{keyPath:'kind'});d.createObjectStore('chunks',{keyPath:['id','part']});}}));
 try{
  const lista=await req(db.transaction('chunks').objectStore('chunks').getAll());
  if(!lista.length)return;
  const sinCifrar=lista.some(c=>!c.ct),otraMaestra=lista.some(c=>c.ct&&c.m!==llaves.maestra);
  if(sinCifrar||otraMaestra){await borrarTodo(db);aviso(sinCifrar?'Por seguridad se borraron las bases anteriores, que estaban guardadas sin cifrar. Vuelve a cargarlas; desde ahora se guardarán cifradas.':'El administrador cambió la llave maestra. Por seguridad se borraron las bases anteriores. Vuelve a cargarlas.');return;}
  const viejas=lista.filter(c=>c.k!==hoy);if(!viejas.length)return;
  const atras=llaves.dias[hoy].atras||{},porFecha={};
  const diaKey=await C.aesKey(dia);
  for(const c of viejas){if(porFecha[c.k])continue;const a=atras[c.k];
   if(!a){await borrarTodo(db);aviso('Las bases se cifraron hace más de 30 días y ya no se pueden abrir. Por seguridad se borraron. Vuelve a cargarlas.');return;}
   const vieja=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:C.unb64(a.iv)},diaKey,C.unb64(a.ct)));porFecha[c.k]=await C.moduloKey(vieja,MODULO);vieja.fill(0);}
  msg('Actualizando el cifrado del día…',false);const bar=gate.querySelector('.at250-bar');bar.hidden=false;
  let i=0;for(const c of viejas){const rows=await C.dec(porFecha[c.k],c);const n=await C.enc(modKey,rows);
   await new Promise((a,b)=>{const t=db.transaction('chunks','readwrite');t.objectStore('chunks').put({id:c.id,part:c.part,m:llaves.maestra,k:hoy,n:c.n,iv:n.iv,ct:n.ct});t.oncomplete=a;t.onerror=()=>b(t.error);});
   if(++i%20===0||i===viejas.length)$('at250-fill').style.width=Math.round(100*i/viejas.length)+'%';}
  bar.hidden=true;
 }finally{db.close();}
}
function aviso(t){window.addEventListener('at250-desbloqueado',()=>{const d=document.createElement('dialog');d.className='msg-dialog';d.innerHTML='<h2>Atenuados · Seguridad</h2><p></p><button type="button">Aceptar</button>';d.querySelector('p').textContent=t;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();},{once:true});}

// ---------- 4. Inactividad (5 min) y cierre a las 20:00 ----------
const banner=document.createElement('div');banner.id='at250-banner';banner.setAttribute('role','alertdialog');banner.hidden=true;banner.innerHTML='<p id="at250-btext"></p><button type="button" id="at250-seguir">Seguir trabajando</button>';
['pointermove','pointerdown','keydown','wheel','touchstart','scroll'].forEach(ev=>window.addEventListener(ev,()=>{if(key&&!cerrando){ultimo=performance.now();S.ping();if(banner.dataset.tipo==='inactividad')banner.hidden=true;}},{passive:true,capture:true}));
function iniciarRelojes(){document.body.append(banner);$('at250-seguir').onclick=()=>{ultimo=performance.now();banner.hidden=true;};
 timer=setInterval(async()=>{if(!key||cerrando)return;
  const pared=Date.now(),salto=Math.abs(pared-ultimaPared-1000);ultimaPared=pared;
  if(salto>90000){ // la laptop se suspendió o cambiaron el reloj: se vuelve a preguntar la hora al servidor
   if(salto>=INACTIVO&&!ocupado){bloquear('inactividad');return;}
   try{const hz=await horaServidor();if(!hz||!hz.h||hz.fecha!==fecha){bloquear('horario');return;}}catch{bloquear('sin-hora');return;}}
  const t=mx(ahora());
  if(t.fecha!==fecha||t.h>=CIERRA){if(ocupado){mostrar('horario','Son las 20:00. La herramienta se cerrará al terminar el proceso en curso.');return;}bloquear('horario');return;}
  if(t.h===CIERRA-1&&t.m>=55){mostrar('horario','La herramienta se cerrará a las 20:00. Guarda o exporta lo que necesites.');}
  if(ocupado){ultimo=performance.now();return;}
  const idle=performance.now()-ultimo;
  if(idle>=INACTIVO){bloquear('inactividad');return;}
  if(idle>=AVISO)mostrar('inactividad',`El módulo se cerrará en ${Math.max(0,Math.ceil((INACTIVO-idle)/1000))} segundos por inactividad.`);
 },1000);}
function mostrar(tipo,t){if(tipo==='inactividad'&&banner.dataset.tipo==='horario'&&!banner.hidden)return;banner.dataset.tipo=tipo;$('at250-btext').textContent=t;$('at250-seguir').hidden=tipo!=='inactividad';banner.hidden=false;}
function bloquear(motivo){if(cerrando)return;cerrando=true;key=null;clearInterval(timer);
 window.dispatchEvent(new CustomEvent('at250-bloqueo',{detail:motivo}));
 document.documentElement.classList.add('at250-locked');document.body.replaceChildren();
 try{window.close();}catch{}setTimeout(()=>location.replace('index.html'),400);}

window.AT250=Object.freeze({
 get key(){return key;},get fecha(){return fecha;},get maestra(){return maestra;},
 ocupado(on){ocupado=Math.max(0,ocupado+(on?1:-1));if(!on)ultimo=performance.now();},
 bloquear
});
})();
