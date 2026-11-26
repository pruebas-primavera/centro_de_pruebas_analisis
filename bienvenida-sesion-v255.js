/* V-2.53 · Contraseña única en la Bienvenida.
   Atenuados, Planta Externa, Soportes y Repeat 60 piden la contraseña del día UNA sola vez, aquí. Con la sesión abierta, sus tarjetas abren
   el módulo con un pase de un solo uso (60 s) y el módulo recibe el material del día por BroadcastChannel (mismo origen).
   La sesión vive solo en la memoria de esta pestaña: se borra a las 20:00, tras 5 min sin uso en la herramienta o al cerrar.
   Operación diaria no cambia. V-2.54: se agrega Soportes. V-2.55: se agrega Repeat 60 y la recarga (F5) dentro del módulo mientras la sesión siga abierta. */
(()=>{'use strict';
if(new URLSearchParams(location.search).get('tool')==='soporte')return;   // pestaña de Soportes: sin sesión
const S=PrimaveraSesion,C=at250Cripto(),INTENTOS='primavera-intentos-atenuados';
const PROTEGIDOS={welcomeAttenuated:{url:'atenuados.html',nombre:'Atenuados'},welcomePlant:{url:'masivos.html',nombre:'Planta Externa'},welcomeSupport:{url:'index.html?tool=soporte',nombre:'Soportes'},welcomeRepeat:{url:'repeat60.html',nombre:'Repeat 60'}};
const R=S.reloj();let dia=null,fecha=null,ultimo=0,pases=new Map(),pestanas=new Set(),pendiente=null,timer=null,horario=null,llaves=null,hoy=null;

/* ---------- Canal: entrega del material del día a los módulos y actividad ---------- */
let ch=null;try{ch=new BroadcastChannel(S.CANAL);}catch{}
if(ch)ch.onmessage=e=>{const d=e.data;if(!d)return;
 if(d.tipo==='actividad'){if(dia)ultimo=performance.now();return;}
 if(d.tipo==='pedir'){if(!dia||typeof d.token!=='string')return;
  if(d.token.startsWith('r:')){const m=d.token.slice(2);if(!m||m!==d.marca||!pestanas.has(m))return;}   // recarga (F5) de una pestaña que abrió esta sesión
  else{const p=pases.get(d.token);if(!p||Date.now()>p.vence)return;pases.delete(d.token);if(typeof d.marca==='string'&&d.marca)pestanas.add(d.marca);}
  ultimo=performance.now();
  ch.postMessage({tipo:'sesion',nonce:d.nonce,fecha,dia:dia.slice()});}};
['pointermove','pointerdown','keydown','wheel','touchstart','scroll'].forEach(ev=>window.addEventListener(ev,()=>{if(dia)ultimo=performance.now();},{passive:true,capture:true}));

function abrir(url){const t=S.token();pases.set(t,{vence:Date.now()+60000});
 const w=window.open(url+'#e='+t,'_blank');if(w){try{w.opener=null;}catch{}return true;}pases.delete(t);return false;}
function cerrarSesion(){if(dia)dia.fill(0);dia=null;fecha=null;pases.clear();pestanas.clear();clearInterval(timer);timer=null;}
function vigilar(){clearInterval(timer);timer=setInterval(()=>{if(!dia)return;const t=S.mx(R.ahora());
 if(t.fecha!==fecha||t.h>=S.CIERRA||performance.now()-ultimo>=S.INACTIVO)cerrarSesion();},1000);}

/* ---------- Ventana de contraseña ---------- */
const box=document.createElement('div');box.id='ps-gate';box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','ps-title');
box.innerHTML='<form class="ps-card" autocomplete="off"><h2 id="ps-title">Acceso</h2><p id="ps-text">Verificando hora del servidor…</p><label for="ps-pw">Contraseña del día</label><input id="ps-pw" type="password" autocomplete="off" spellcheck="false" maxlength="64" disabled><button type="submit" id="ps-go" disabled>Entrar</button><p id="ps-msg" role="alert"></p><button type="button" id="ps-open" class="ps-secondary" hidden></button><button type="button" id="ps-cancel" class="ps-link">Cancelar</button></form>';
const $=id=>box.querySelector('#'+id);
const msg=(t,err=true)=>{const m=$('ps-msg');m.textContent=t;m.classList.toggle('ok',!err);};
function ocultar(){box.hidden=true;pendiente=null;$('ps-pw').value='';msg('',false);}
async function mostrar(destino){pendiente=destino;if(!box.isConnected)document.body.append(box);box.hidden=false;
 $('ps-title').textContent=destino.nombre+' · Acceso';$('ps-open').hidden=true;$('ps-pw').disabled=true;$('ps-go').disabled=true;$('ps-pw').hidden=false;$('ps-go').hidden=false;msg('',false);
 $('ps-text').textContent='Verificando hora del servidor…';
 try{horario=await R.horario();}catch{$('ps-text').textContent='No se pudo verificar la hora del servidor. Abre la herramienta desde la página publicada y con internet o VPN.';return;}
 const t=S.mx(R.ahora());hoy=t.fecha;
 if(t.h<S.ABRE||t.h>=S.CIERRA){$('ps-text').textContent=`Fuera de horario. La herramienta se puede abrir de 0${S.ABRE}:00 a ${S.CIERRA}:00 (hora del servidor: ${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}).`;return;}
 if(!horario||horario.fecha!==hoy||!horario.h){$('ps-text').textContent='La llave de horario de hoy todavía no está publicada. Intenta de nuevo en unos minutos.';return;}
 try{llaves=await S.llaves();}catch{$('ps-text').textContent='No se encontró el archivo de llaves. Contacta al administrador.';return;}
 if(!llaves.dias?.[hoy]){$('ps-text').textContent='Contraseñas vencidas. Contacta al administrador.';return;}
 $('ps-text').textContent='Escribe la contraseña del día. Se pide una sola vez para todos los módulos.';$('ps-pw').disabled=false;$('ps-go').disabled=false;$('ps-pw').focus();}
function espera(){try{return JSON.parse(localStorage.getItem(INTENTOS)||'{"n":0,"t":0}');}catch{return {n:0,t:0};}}
box.addEventListener('submit',async e=>{e.preventDefault();if(!pendiente)return;
 const s=espera();if(s.n>=5&&Date.now()-s.t<60000){msg(`Demasiados intentos. Espera ${Math.ceil((60000-(Date.now()-s.t))/1000)} s.`);return;}
 const pw=$('ps-pw').value;if(!pw){msg('Escribe la contraseña.');return;}
 $('ps-go').disabled=true;$('ps-pw').disabled=true;msg('Verificando…',false);
 let d=null;
 try{const t=S.mx(R.ahora());if(t.fecha!==hoy||t.h>=S.CIERRA)throw Error('horario');
  const caja=llaves.dias[hoy];const k=await C.cajaKey(pw,horario.h,hoy,C.unb64(caja.salt),llaves.iter||600000);
  d=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:C.unb64(caja.iv)},k,C.unb64(caja.ct)));
 }catch(err){$('ps-pw').value='';$('ps-go').disabled=false;$('ps-pw').disabled=false;$('ps-pw').focus();
  if(err.message==='horario'){msg('Se terminó el horario o cambió el día.');return;}
  const n=(s.n>=5?0:s.n)+1;try{localStorage.setItem(INTENTOS,JSON.stringify({n,t:Date.now()}));}catch{}msg(n>=5?'Contraseña incorrecta. Espera 1 minuto para intentar de nuevo.':'Contraseña incorrecta.');return;}
 try{localStorage.removeItem(INTENTOS);}catch{}
 cerrarSesion();dia=d;fecha=hoy;ultimo=performance.now();vigilar();$('ps-pw').value='';
 const destino=pendiente;
 if(abrir(destino.url)){ocultar();return;}
 // El navegador bloqueó la pestaña nueva: un clic más la abre.
 $('ps-pw').hidden=true;$('ps-go').hidden=true;$('ps-text').textContent='Contraseña correcta.';msg('',false);
 const b=$('ps-open');b.textContent='Abrir '+destino.nombre;b.hidden=false;b.focus();
});
$('ps-open').addEventListener('click',()=>{if(pendiente&&dia&&abrir(pendiente.url))ocultar();});
$('ps-cancel').addEventListener('click',ocultar);
box.addEventListener('keydown',e=>{if(e.key==='Escape')ocultar();});

/* ---------- Tarjetas protegidas (se atienden antes que la navegación normal) ---------- */
document.addEventListener('click',e=>{const card=e.target.closest?.('#welcomeAttenuated,#welcomePlant,#welcomeSupport,#welcomeRepeat');if(!card)return;
 e.preventDefault();e.stopImmediatePropagation();const destino=PROTEGIDOS[card.id];
 if(dia){ultimo=performance.now();abrir(destino.url);return;}
 mostrar(destino);},true);
})();
