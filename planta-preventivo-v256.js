/* Planta Externa V-2.56 · Mtto Preventivo.
   - "Mtto Preventivo" carga un KMZ/KML de brazos (Clúster › Nivel › Brazo). Cada carga COMPLEMENTA lo ya cargado:
     solo se dibuja lo nuevo; un brazo idéntico (mismo clúster, nivel, nombre y trazo) no se duplica.
   - "Ver Preventivo" muestra/oculta la capa y el panel con el mismo árbol del archivo.
     Panel: cursor = resalta el renglón; clic = prende (resalta sus líneas y centra el mapa); otro clic = apaga.
   - Colores: Primaria blanco (5) · Secundaria aqua (4) · Distribución azul (3).
   - Cursor sobre una línea = su nombre; clic = nombre(s), carpeta y nota. Lista de archivos con "Borrar".
   - Se guarda cifrado (PE253, mismo almacén que el histórico). No toca masivos, filtros, coberturas ni exportes. */
(()=>{'use strict';
const P=window.PE253;
const NIVEL={primaria:{color:'#ffffff',w:5,orden:0,txt:'Primaria'},secundaria:{color:'#00ffff',w:4,orden:1,txt:'Secundaria'},distribucion:{color:'#1e5bff',w:3,orden:2,txt:'Distribución'},otro:{color:'#1e5bff',w:3,orden:3,txt:'Otro'}};
const norm=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
const tipo=n=>{const u=norm(n);return u.includes('PRIMARIA')?'primaria':u.includes('SECUNDARIA')?'secundaria':u.includes('DISTRIBU')?'distribucion':'otro';};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map=null,pane=null,capa=null,datos={arbol:[],brazos:[],archivos:[]},encendidos=new Set(),visible=false,lineas=new Map(),resaltado=null,listoDatos=null;
const $=id=>document.getElementById(id);

/* ---------- Lectura del KMZ respetando su árbol ---------- */
async function leerArchivo(file){
 if(/\.kml$/i.test(file.name))return file.text();
 if(!window.JSZip)throw Error('No se pudo cargar el lector de KMZ.');
 const zip=await JSZip.loadAsync(file);const kml=Object.values(zip.files).find(f=>!f.dir&&/\.kml$/i.test(f.name));
 if(!kml)throw Error('El KMZ no contiene un archivo KML.');return kml.async('string');
}
function extraer(xml,archivo){
 const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('El archivo KML contiene XML inválido.');
 const hijos=(e,t)=>[...e.children].filter(c=>c.localName===t);const nom=e=>(hijos(e,'name')[0]?.textContent||'').trim();
 const arbol=[],brazos=[];let ignorados=0;
 // Carpetas: la última es el Nivel y la anterior el Clúster (como BRAZOS RECORRIDOS › PATRIA › DISTRIBUCION).
 function recorrer(nodo,ruta){
  for(const c of nodo.children){
   if(c.localName==='Folder'||c.localName==='Document'){recorrer(c,c.localName==='Folder'?[...ruta,nom(c)]:ruta);continue;}
   if(c.localName!=='Placemark')continue;
   const ls=[...c.getElementsByTagNameNS('*','LineString')];if(!ls.length){ignorados++;continue;}
   const nivel=ruta[ruta.length-1]||'Sin nivel',cluster=ruta.length>=2?ruta[ruta.length-2]:'Sin clúster';
   const nota=(hijos(c,'description')[0]?.textContent||'').trim();
   for(const l of ls){const t=(l.getElementsByTagNameNS('*','coordinates')[0]?.textContent||'').trim();
    const pts=t.split(/\s+/).map(x=>x.split(',').map(Number)).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>[+p[1].toFixed(7),+p[0].toFixed(7)]);
    if(pts.length>=2)brazos.push({cluster,nivel,nombre:nom(c)||'(sin nombre)',nota,pts,src:archivo});}
  }
 }
 // Registrar también las carpetas vacías (p. ej. SANTA ANA): son hermanas de los clústeres que sí traen niveles.
 function carpetas(){const folders=[...doc.getElementsByTagNameNS('*','Folder')];
  const niveles=folders.filter(f=>[...f.children].some(x=>x.localName==='Placemark'));
  const abuelos=new Set(niveles.map(f=>f.parentElement?.parentElement).filter(Boolean));
  for(const g of abuelos)for(const c of g.children)if(c.localName==='Folder'&&!niveles.includes(c))arbol.push({cluster:nom(c),nivel:null});}
 recorrer(doc.documentElement,[]);carpetas();
 for(const b of brazos)arbol.push({cluster:b.cluster,nivel:b.nivel});
 return {arbol,brazos,ignorados};
}
const huella=b=>[b.cluster,b.nivel,b.nombre,b.pts.map(p=>p.join(',')).join(' ')].join('|');

/* ---------- Árbol ---------- */
function estructura(){
 const cl=new Map();
 const add=(c,n)=>{if(!cl.has(c))cl.set(c,new Map());if(n!=null&&!cl.get(c).has(n))cl.get(c).set(n,[]);};
 for(const a of datos.arbol)add(a.cluster,a.nivel);
 datos.brazos.forEach((b,i)=>{add(b.cluster,b.nivel);cl.get(b.cluster).get(b.nivel).push(i);});
 return cl;
}
const idCl=c=>'c|'+c,idNv=(c,n)=>'n|'+c+'|'+n,idBr=i=>'b|'+i;
function brazosDe(id){const [t,...r]=id.split('|');if(t==='b')return [Number(r[0])];
 return datos.brazos.map((b,i)=>[b,i]).filter(([b])=>t==='c'?b.cluster===r[0]:b.cluster===r[0]&&b.nivel===r.slice(1).join('|')).map(([,i])=>i);}
function estado(id){const ids=brazosDe(id);if(!ids.length)return 'vacio';const on=ids.filter(i=>encendidos.has(i)).length;return on===0?'apagado':on===ids.length?'prendido':'parcial';}

/* ---------- Dibujo ---------- */
function estilo(b){const t=NIVEL[tipo(b.nivel)];return {pane:'preventivo256',color:t.color,weight:t.w,opacity:1,lineCap:'round',lineJoin:'round'};}
function dibujar(){
 if(!map)return;capa.clearLayers();lineas.clear();
 if(!visible)return;
 // Brazos con el mismo trazo comparten una línea (sus nombres salen juntos).
 const grupos=new Map();
 [...encendidos].sort((a,b)=>NIVEL[tipo(datos.brazos[b].nivel)].orden-NIVEL[tipo(datos.brazos[a].nivel)].orden).forEach(i=>{const b=datos.brazos[i];const k=b.pts.map(p=>p.join(',')).join(' ');(grupos.get(k)||grupos.set(k,[]).get(k)).push(i);});
 for(const ids of grupos.values()){const b=datos.brazos[ids[0]];
  const sombra=L.polyline(b.pts,{pane:'preventivo256',color:'#0b1430',weight:NIVEL[tipo(b.nivel)].w+2,opacity:.55,interactive:false}).addTo(capa);
  const l=L.polyline(b.pts,estilo(b)).addTo(capa);
  const nombres=ids.map(i=>datos.brazos[i].nombre);
  l.bindTooltip(nombres.map(esc).join('<br>'),{sticky:true,className:'pv256-tip'});
  l.bindPopup(()=>`<div class="pv256-pop">${ids.map(i=>{const x=datos.brazos[i];return `<b>${esc(x.nombre)}</b><span>${esc(x.cluster)} › ${esc(x.nivel)}</span>${x.nota?`<em>${esc(x.nota)}</em>`:''}`;}).join('<hr>')}</div>`,{maxWidth:320});
  ids.forEach(i=>lineas.set(i,[sombra,l]));
 }
 marcar();
}
function marcar(){
 capa.eachLayer(l=>{if(l._pv256Glow)capa.removeLayer(l);});
 if(!resaltado)return;
 for(const i of brazosDe(resaltado)){const par=lineas.get(i);if(!par)continue;
  const g=L.polyline(par[1].getLatLngs(),{pane:'preventivo256',color:'#ff690b',weight:NIVEL[tipo(datos.brazos[i].nivel)].w+8,opacity:.55,interactive:false});g._pv256Glow=true;g.addTo(capa);g.bringToBack();}
}
function centrar(id){const ids=brazosDe(id);if(!ids.length)return;const bb=L.latLngBounds(ids.flatMap(i=>datos.brazos[i].pts));if(bb.isValid())map.fitBounds(bb,{padding:[40,40],maxZoom:17});}

/* ---------- Panel ---------- */
let abiertos=new Set();
function panel(){
 const box=$('pv256Panel');if(!box)return;const cl=estructura();
 const fila=(id,txt,nivelCls,cuenta,flecha)=>{const st=estado(id);return `<div class="pv256-row ${nivelCls} ${st}${resaltado===id?' sel':''}" data-id="${esc(id)}" role="button" tabindex="0">${flecha!=null?`<span class="pv256-arrow" data-tog="${esc(id)}">${flecha?'▾':'▸'}</span>`:'<span class="pv256-arrow"></span>'}<span class="pv256-chk"></span><span class="pv256-txt">${esc(txt)}</span>${cuenta!=null?`<small>${cuenta}</small>`:''}</div>`;};
 let h='';
 for(const [c,niveles] of cl){const ic=idCl(c),open=abiertos.has(ic),tot=[...niveles.values()].reduce((s,a)=>s+a.length,0);
  h+=fila(ic,c,'cl',tot,niveles.size?open:null);
  if(open)for(const [n,ids] of [...niveles].sort((a,b)=>NIVEL[tipo(a[0])].orden-NIVEL[tipo(b[0])].orden)){const inv=idNv(c,n),on=abiertos.has(inv);
   h+=`<div class="pv256-sub">${fila(inv,n,'nv nv-'+tipo(n),ids.length,ids.length?on:null)}`;
   if(on)h+=`<div class="pv256-sub">${ids.map(i=>fila(idBr(i),datos.brazos[i].nombre,'br nv-'+tipo(n),null,null)).join('')}</div>`;
   h+='</div>';}
 }
 $('pv256Tree').innerHTML=h||'<p class="pv256-vacio">Carga un KMZ con el botón Mtto Preventivo.</p>';
 $('pv256Files').innerHTML=datos.archivos.length?datos.archivos.map((f,i)=>`<li><span title="${esc(f.nombre)}">${esc(f.nombre)}</span><small>${f.n} brazos</small><button type="button" class="pv256-del" data-del="${i}">Borrar</button></li>`).join(''):'<li class="pv256-vacio">Sin archivos cargados.</li>';
}
function clicFila(id){
 const ids=brazosDe(id);if(!ids.length)return;
 if(estado(id)==='prendido'){ids.forEach(i=>encendidos.delete(i));if(resaltado===id)resaltado=null;}
 else{ids.forEach(i=>encendidos.add(i));resaltado=id;centrar(id);}
 dibujar();panel();
}
function mostrar(on){visible=on;$('pv256Toggle').setAttribute('aria-pressed',String(on));$('pv256Panel').hidden=!on;dibujar();panel();}

/* ---------- Guardar / cargar / borrar ---------- */
async function guardar(){await P.guardarPreventivo(datos);}
async function cargar(file){
 P.ocupado(true);const btn=$('pv256Load');btn.classList.add('busy');
 try{const xml=await leerArchivo(file);const r=extraer(xml,file.name);
  const ya=new Set(datos.brazos.map(huella));let nuevos=0,repetidos=0;
  for(const a of r.arbol)if(!datos.arbol.some(x=>x.cluster===a.cluster&&x.nivel===a.nivel))datos.arbol.push(a);
  for(const b of r.brazos){const h=huella(b);if(ya.has(h)){repetidos++;continue;}ya.add(h);datos.brazos.push(b);nuevos++;}
  if(nuevos){const f=datos.archivos.find(x=>x.nombre===file.name);if(f)f.n+=nuevos;else datos.archivos.push({nombre:file.name,n:nuevos,cargado:new Date().toISOString()});}
  await guardar();$('pv256Toggle').disabled=false;if(!visible)mostrar(true);else{dibujar();panel();}
  aviso(`${file.name}\n${nuevos} brazos nuevos dibujados · ${repetidos} ya estaban cargados${r.ignorados?` · ${r.ignorados} elementos que no son líneas no se dibujan`:''}.`);
 }catch(e){aviso('No se pudo cargar el archivo: '+e.message);}
 finally{P.ocupado(false);btn.classList.remove('busy');$('pv256File').value='';}
}
async function borrar(i){
 const f=datos.archivos[i];if(!f)return;
 if(!await confirmar(`¿Borrar "${f.nombre}" (${f.n} brazos) de Mtto Preventivo?\nLos demás archivos, los masivos y las coberturas no se tocan.`))return;
 const quitar=new Set();datos.brazos.forEach((b,k)=>{if(b.src===f.nombre)quitar.add(k);});
 const mapa=new Map();const nuevos=[];datos.brazos.forEach((b,k)=>{if(!quitar.has(k)){mapa.set(k,nuevos.length);nuevos.push(b);}});
 datos.brazos=nuevos;datos.archivos.splice(i,1);
 const quedan=new Set(datos.brazos.map(b=>b.cluster+'|'+b.nivel));datos.arbol=datos.arbol.filter(a=>a.nivel==null?datos.archivos.length>0:quedan.has(a.cluster+'|'+a.nivel));
 encendidos=new Set([...encendidos].filter(k=>mapa.has(k)).map(k=>mapa.get(k)));resaltado=null;
 await guardar();if(!datos.brazos.length&&!datos.arbol.length)$('pv256Toggle').disabled=true;dibujar();panel();
}
function aviso(t){const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog';d.innerHTML='<h2>Mtto Preventivo</h2><p style="white-space:pre-line"></p><div><button type="button">Aceptar</button></div>';d.querySelector('p').textContent=t;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();}
function confirmar(t){return new Promise(res=>{const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog';d.innerHTML='<h2>Mtto Preventivo</h2><p style="white-space:pre-line"></p><div><button type="button" class="no">Cancelar</button><button type="button" class="si">Borrar</button></div>';d.querySelector('p').textContent=t;
 const fin=v=>{d.close();d.remove();res(v);};d.querySelector('.no').onclick=()=>fin(false);d.querySelector('.si').onclick=()=>fin(true);d.addEventListener('cancel',e=>{e.preventDefault();fin(false);});document.body.append(d);d.showModal();});}

/* ---------- Arranque: se engancha al mismo mapa que usan las coberturas ---------- */
const prev=window.initCoverageV53;
window.initCoverageV53=function(leafletMap){
 try{prev&&prev(leafletMap);}finally{
  map=leafletMap;map.createPane('preventivo256');pane=map.getPane('preventivo256');pane.style.zIndex='420';capa=L.layerGroup().addTo(map);
  const box=document.createElement('div');box.id='pv256Panel';box.hidden=true;
  box.innerHTML='<div class="pv256-head"><b>Mtto Preventivo</b><span class="pv256-legend"><i class="lg-primaria"></i>Primaria<i class="lg-secundaria"></i>Secundaria<i class="lg-distribucion"></i>Distribución</span><button type="button" id="pv256Close" aria-label="Cerrar">×</button></div><div id="pv256Tree" class="pv256-tree"></div><div class="pv256-files"><b>Archivos cargados</b><ul id="pv256Files"></ul></div>';
  map.getContainer().append(box);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
  box.addEventListener('click',e=>{const tog=e.target.closest('[data-tog]');if(tog){const id=tog.dataset.tog;abiertos.has(id)?abiertos.delete(id):abiertos.add(id);panel();return;}
   const del=e.target.closest('[data-del]');if(del){borrar(Number(del.dataset.del));return;}
   const row=e.target.closest('.pv256-row');if(row)clicFila(row.dataset.id);});
  box.addEventListener('keydown',e=>{const row=e.target.closest('.pv256-row');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();clicFila(row.dataset.id);}});
  $('pv256Close').onclick=()=>mostrar(false);
  listoDatos=P.cargarPreventivo().then(v=>{if(v&&Array.isArray(v.brazos)){datos={arbol:v.arbol||[],brazos:v.brazos,archivos:v.archivos||[]};$('pv256Toggle').disabled=!datos.brazos.length&&!datos.arbol.length;}}).catch(e=>console.warn('Mtto Preventivo:',e));
 }
};
function botones(){
 const acts=document.querySelector('header .actions'),cov=document.querySelector('header .coverage-load');
 if(acts&&!$('pv256Load')){const l=document.createElement('label');l.className='btn orange pv256-load';l.id='pv256Load';l.innerHTML='Mtto Preventivo<input type="file" id="pv256File" accept=".kmz,.kml" hidden>';(cov?cov.after(l):acts.prepend(l));
  $('pv256File').addEventListener('change',e=>{const f=e.target.files[0];if(f)cargar(f);});}
 const ver=$('coverageToggle');
 if(ver&&!$('pv256Toggle')){const b=document.createElement('button');b.type='button';b.id='pv256Toggle';b.className='btn pv256-toggle';b.disabled=true;b.setAttribute('aria-pressed','false');b.textContent='Ver Preventivo';ver.after(b);
  b.addEventListener('click',()=>mostrar(!visible));}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',botones,{once:true});else botones();
})();
