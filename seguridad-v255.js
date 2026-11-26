/* V-2.53 · Seguridad compartida del Centro de Análisis Operativo (Bienvenida, Atenuados y Planta Externa).
   - at250Cripto(): funciones de cifrado (sin cambios desde V-2.49; también se inyectan como texto en los Workers de Atenuados).
   - PrimaveraSesion: hora del servidor, horario 09:00–20:00 y el "pase" con el que un módulo recibe de la Bienvenida
     el material del día (contraseña escrita una sola vez). El intercambio usa BroadcastChannel del mismo origen;
     no se guarda ninguna llave en localStorage ni en sessionStorage. Sin solicitudes de red fuera del propio sitio. */

// Funciones puras de cifrado (idénticas a V-2.49).
function at250Cripto(){
 const te=new TextEncoder(),td=new TextDecoder();
 const b64=u=>{const a=u instanceof Uint8Array?u:new Uint8Array(u);let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return btoa(s);};
 const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 // Empaquetado que conserva exactamente cada fila (incluidas celdas vacías / huecos del arreglo).
 function pack(rows){return te.encode(JSON.stringify(rows.map(r=>{if(!Array.isArray(r))return {o:r};const e=[r.length];for(const k of Object.keys(r)){const v=r[k];e.push(v===undefined?[+k]:[+k,v]);}return e;})));}
 function unpack(bytes){return JSON.parse(td.decode(bytes)).map(e=>{if(!Array.isArray(e))return e.o;const r=new Array(e[0]);for(let i=1;i<e.length;i++){const x=e[i];r[x[0]]=x.length>1?x[1]:undefined;}return r;});}
 async function enc(key,rows){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,pack(rows));return {iv,ct};}
 async function dec(key,rec){return unpack(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:rec.iv},key,rec.ct)));}
 async function pbkdf2Bits(pw,salt,iter){const k=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},k,256));}
 async function hkdfBytes(ikm,salt,info){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:te.encode(info)},k,256));}
 const aesKey=(raw,extractable=false)=>crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},extractable,['encrypt','decrypt']);
 async function hmacB64(secret,msg){const k=await crypto.subtle.importKey('raw',te.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',k,te.encode(msg)));}
 // Llave que abre la "caja" del día: contraseña del día + llave de horario del día.
 async function cajaKey(pw,horarioB64,fecha,salt,iter){const pb=await pbkdf2Bits(pw,salt,iter),hb=unb64(horarioB64),ikm=new Uint8Array(pb.length+hb.length);ikm.set(pb);ikm.set(hb,pb.length);const k=await aesKey(await hkdfBytes(ikm,salt,'primavera|caja|'+fecha));pb.fill(0);ikm.fill(0);return k;}
 const diaRaw=(maestra,fecha)=>hkdfBytes(maestra,new Uint8Array(32),'primavera|datos|'+fecha);
 async function moduloKey(diaBytes,modulo){const raw=await hkdfBytes(diaBytes,new Uint8Array(32),'primavera|modulo|'+modulo);const k=await aesKey(raw);raw.fill(0);return k;}
 return {te,td,b64,unb64,pack,unpack,enc,dec,pbkdf2Bits,hkdfBytes,aesKey,hmacB64,cajaKey,diaRaw,moduloKey};
}

/* V-2.55 · Igual que seguridad-v253.js + recarga (F5) dentro del módulo mientras la sesión de la Bienvenida siga abierta. */
const PrimaveraSesion=(()=>{'use strict';
 const CANAL='primavera-sesion-v253',ABRE=9,CIERRA=20,INACTIVO=300000,AVISO=270000,PING=15000;
 const mx=ms=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return {fecha:`${p.year}-${p.month}-${p.day}`,h:+p.hour,m:+p.minute,s:+p.second};};
 // Reloj basado en la cabecera Date del servidor (no en el reloj de la laptop).
 function reloj(){let base=0,ultimaPared=0;return {
  ahora:()=>base+performance.now(),
  get ultimaPared(){return ultimaPared;},set ultimaPared(v){ultimaPared=v;},
  async horario(){const t0=performance.now();const r=await fetch('horario.json?t='+Date.now(),{cache:'no-store'});const d=r.headers.get('Date');if(!r.ok||!d)throw Error('sin hora');const ms=Date.parse(d);if(!Number.isFinite(ms))throw Error('sin hora');base=ms-(t0+performance.now())/2;ultimaPared=Date.now();return r.json();}};}
 async function llaves(){const r=await fetch('llaves.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('sin llaves');return r.json();}
 const token=()=>{const a=new Uint8Array(18);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
 // Módulo: lee el pase de un solo uso (#e=...) y pide a la Bienvenida el material del día.
 // V-2.55 · Recarga (F5): al entrar con el pase, la pestaña guarda una marca al azar en sessionStorage (solo esa pestaña; no es llave
 // ni contraseña). Al recargar, el módulo presenta 'r:<marca>' y la Bienvenida, si la sesión sigue abierta y la marca es suya, lo deja seguir.
 const MARCA='primavera-pestana-v255';
 const leerMarca=()=>{try{return sessionStorage.getItem(MARCA);}catch{return null;}};
 function pase(){const m=/^#e=([A-Za-z0-9_-]{16,})$/.exec(location.hash);
  if(m){history.replaceState(null,'',location.pathname+location.search);try{sessionStorage.setItem(MARCA,token());}catch{}return m[1];}
  const r=leerMarca();return r?'r:'+r:null;}
 function pedir(t,modulo){return new Promise(resolve=>{if(!t||typeof BroadcastChannel!=='function'){resolve(null);return;}
  const reingreso=t.startsWith('r:');
  const ch=new BroadcastChannel(CANAL),nonce=token();const fin=v=>{clearTimeout(to);ch.close();
   if(!v&&reingreso){try{sessionStorage.removeItem(MARCA);}catch{}location.replace('index.html');}   // sin sesión: a la Bienvenida
   resolve(v);};
  const to=setTimeout(()=>fin(null),4000);
  ch.onmessage=e=>{const d=e.data;if(d&&d.tipo==='sesion'&&d.nonce===nonce&&d.dia)fin({dia:new Uint8Array(d.dia),fecha:d.fecha});};
  ch.postMessage({tipo:'pedir',token:t,marca:leerMarca(),nonce,modulo});});}
 // Módulo: avisa a la Bienvenida que hay actividad (mantiene viva la sesión). Como máximo cada 15 s.
 let ultimoPing=0,chPing=null;
 function ping(){const n=performance.now();if(n-ultimoPing<PING)return;ultimoPing=n;try{chPing=chPing||new BroadcastChannel(CANAL);chPing.postMessage({tipo:'actividad'});}catch{}}
 return Object.freeze({CANAL,ABRE,CIERRA,INACTIVO,AVISO,mx,reloj,llaves,token,pase,pedir,ping});
})();
