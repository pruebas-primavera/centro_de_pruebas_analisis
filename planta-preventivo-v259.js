/* Planta Externa V-2.59 · Mtto Preventivo por Año › Mes (base V-2.57; V-2.59 solo cambia la posición inicial del panel).
   - Árbol: Año › Mes › Clúster › Nivel › Brazo (años y meses en orden de calendario). Clic = prende/apaga todo lo de adentro; selección múltiple.
   - "+ Agregar año o mes" crea el mes vacío. "+ KMZ" en un mes carga a ese mes; el botón "Mtto Preventivo" pregunta el mes.
     Dentro del mismo mes cada carga COMPLEMENTA (no reemplaza ni duplica). Cada mes es independiente.
   - "Borrar…": mismo árbol, clic selecciona (con todo lo de adentro) años, meses, clústeres, niveles, brazos o archivos; resumen y confirmación.
   - Colores: Primaria blanco (3) · Secundaria aqua (2) · Distribución azul (1.5). Ventana movible a cualquier parte del tablero.
   - Lo cargado en V-2.56 pasa al mes en que se cargó. Cifrado con PE253 (registro 'preventivo'). No toca masivos, filtros, coberturas ni exportes. */
(()=>{'use strict';
const P=window.PE253;
const NIVEL={primaria:{color:'#ffffff',w:3,orden:0,txt:'Primaria'},secundaria:{color:'#00ffff',w:2,orden:1,txt:'Secundaria'},distribucion:{color:'#1e5bff',w:1.5,orden:2,txt:'Distribución'},otro:{color:'#1e5bff',w:1.5,orden:3,txt:'Otro'}};
const norm=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
const tipo=n=>{const u=norm(n);return u.includes('PRIMARIA')?'primaria':u.includes('SECUNDARIA')?'secundaria':u.includes('DISTRIBU')?'distribucion':'otro';};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map=null,pane=null,capa=null,datos={v:2,meses:[],arbol:[],brazos:[],archivos:[]},encendidos=new Set(),visible=false,lineas=new Map(),resaltado=null,listoDatos=null;
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
const huella=b=>[b.p,b.cluster,b.nivel,b.nombre,b.pts.map(p=>p.join(',')).join(' ')].join('|');
const MESES=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const mesTxt=p=>MESES[Number(p.slice(5,7))-1]||p,mesLargo=p=>mesTxt(p).charAt(0)+mesTxt(p).slice(1).toLowerCase()+' '+p.slice(0,4);
const hoyP=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};

/* ---------- Árbol: Año › Mes › Clúster › Nivel › Brazo ---------- */
const sep='\u0001';
const idA=y=>'a'+sep+y,idM=p=>'m'+sep+p,idCl=(p,c)=>'c'+sep+p+sep+c,idNv=(p,c,n)=>'n'+sep+p+sep+c+sep+n,idBr=i=>'b'+sep+i,idF=(p,f)=>'f'+sep+p+sep+f;
const partes=id=>id.split(sep);
function anios(){const ys=new Set(datos.meses.map(p=>p.slice(0,4)));return [...ys].sort();}
function mesesDe(y){return datos.meses.filter(p=>p.startsWith(y+'-')).sort();}
function estructura(p){
 const cl=new Map();
 const add=(c,n)=>{if(!cl.has(c))cl.set(c,new Map());if(n!=null&&!cl.get(c).has(n))cl.get(c).set(n,[]);};
 for(const a of datos.arbol)if(a.p===p)add(a.cluster,a.nivel);
 datos.brazos.forEach((b,i)=>{if(b.p!==p)return;add(b.cluster,b.nivel);cl.get(b.cluster).get(b.nivel).push(i);});
 return cl;
}
function brazosDe(id){const [t,...r]=partes(id);if(t==='b')return [Number(r[0])];
 return datos.brazos.map((b,i)=>[b,i]).filter(([b])=>t==='a'?b.p.startsWith(r[0]+'-'):t==='m'?b.p===r[0]:t==='c'?b.p===r[0]&&b.cluster===r[1]:t==='n'?b.p===r[0]&&b.cluster===r[1]&&b.nivel===r[2]:t==='f'?b.p===r[0]&&b.src===r[1]:false).map(([,i])=>i);}
function estado(id){const ids=brazosDe(id);if(!ids.length)return 'vacio';const on=ids.filter(i=>encendidos.has(i)).length;return on===0?'apagado':on===ids.length?'prendido':'parcial';}
function asegurarMes(p){if(!datos.meses.includes(p)){datos.meses.push(p);datos.meses.sort();}}
function migrar(v){ // V-2.56 → V-2.57: lo ya cargado queda en el mes en que se cargó.
 if(v.v===2)return {v:2,meses:v.meses||[],arbol:v.arbol||[],brazos:v.brazos||[],archivos:v.archivos||[]};
 const f=(v.archivos||[])[0]?.cargado;const p=f?String(f).slice(0,7):hoyP();
 return {v:2,meses:(v.brazos||[]).length||(v.arbol||[]).length?[p]:[],arbol:(v.arbol||[]).map(a=>({...a,p})),brazos:(v.brazos||[]).map(b=>({...b,p})),archivos:(v.archivos||[]).map(a=>({...a,p}))};
}
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
  l.bindPopup(()=>`<div class="pv256-pop">${ids.map(i=>{const x=datos.brazos[i];return `<b>${esc(x.nombre)}</b><span>${esc(mesLargo(x.p))} › ${esc(x.cluster)} › ${esc(x.nivel)}</span>${x.nota?`<em>${esc(x.nota)}</em>`:''}`;}).join('<hr>')}</div>`,{maxWidth:320});
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
function filaHtml(id,txt,cls,cuenta,flecha,extra,st,sel){return `<div class="pv256-row ${cls} ${st}${sel?' sel':''}" data-id="${esc(id)}" role="button" tabindex="0">${flecha!=null?`<span class="pv256-arrow" data-tog="${esc(id)}">${flecha?'▾':'▸'}</span>`:'<span class="pv256-arrow"></span>'}<span class="pv256-chk"></span><span class="pv256-txt">${esc(txt)}</span>${cuenta!=null?`<small>${cuenta}</small>`:''}${extra||''}</div>`;}
function arbolHtml(fila,abiertosSet,conArchivos){
 let h='';
 for(const y of anios()){const ia=idA(y),oa=abiertosSet.has(ia),ms=mesesDe(y);
  h+=fila(ia,y,'r-an',brazosDe(ia).length,ms.length?oa:null,'');
  if(!oa)continue;h+='<div class="pv256-sub">';
  for(const p of ms){const im=idM(p),om=abiertosSet.has(im),cl=estructura(p),fs=datos.archivos.filter(f=>f.p===p);const hay=cl.size||(conArchivos&&fs.length);
   h+=fila(im,mesTxt(p),'r-mes'+(brazosDe(im).length?'':' gris'),brazosDe(im).length,hay?om:null,conArchivos?'':`<button type="button" class="pv257-kmz" data-kmz="${esc(p)}">+ KMZ</button>`);
   if(!om)continue;h+='<div class="pv256-sub">';
   for(const [c,niveles] of cl){const ic=idCl(p,c),open=abiertosSet.has(ic),tot=[...niveles.values()].reduce((s,a)=>s+a.length,0);
    h+=fila(ic,c,'cl',tot,niveles.size?open:null,'');
    if(open)for(const [n,ids] of [...niveles].sort((a,b)=>NIVEL[tipo(a[0])].orden-NIVEL[tipo(b[0])].orden)){const inv=idNv(p,c,n),on=abiertosSet.has(inv);
     h+=`<div class="pv256-sub">${fila(inv,n,'nv nv-'+tipo(n),ids.length,ids.length?on:null,'')}`;
     if(on)h+=`<div class="pv256-sub">${ids.map(i=>fila(idBr(i),datos.brazos[i].nombre,'br nv-'+tipo(n),null,null,'')).join('')}</div>`;
     h+='</div>';}
   }
   if(conArchivos&&fs.length){const ik='k'+sep+p,ok=abiertosSet.has(ik);h+=`<div class="pv256-row r-arch" data-tog="${esc(ik)}"><span class="pv256-arrow">${ok?'▾':'▸'}</span><span class="pv257-ico">📄</span><span class="pv256-txt">Archivos</span><small>${fs.length}</small></div>`;
    if(ok)h+=`<div class="pv256-sub">${fs.map(f=>fila(idF(p,f.nombre),f.nombre,'r-file',brazosDe(idF(p,f.nombre)).length+' brazos',null,'')).join('')}</div>`;}
   h+='</div>';}
  h+='</div>';}
 return h;
}
function panel(){
 const box=$('pv256Panel');if(!box)return;
 const h=arbolHtml((id,txt,cls,cuenta,flecha,extra)=>filaHtml(id,txt,cls,cuenta,flecha,extra,estado(id),resaltado===id),abiertos,false);
 $('pv256Tree').innerHTML=h||'<p class="pv256-vacio">Agrega un año y mes, o carga un KMZ con el botón Mtto Preventivo.</p>';
 $('pv257Borrar').disabled=!datos.meses.length;
}
function clicFila(id){
 const ids=brazosDe(id);if(!ids.length)return;
 if(estado(id)==='prendido'){ids.forEach(i=>encendidos.delete(i));if(resaltado===id)resaltado=null;}
 else{ids.forEach(i=>encendidos.add(i));resaltado=id;centrar(id);}
 dibujar();panel();
}
function mostrar(on){visible=on;$('pv256Toggle').setAttribute('aria-pressed',String(on));$('pv256Panel').hidden=!on;dibujar();panel();if(on)ubicar();}
/* ---------- Ventana movible a cualquier parte del tablero (V-2.57) ---------- */
const POS='primavera-pv256-posicion';
function leerPos(){try{const v=JSON.parse(localStorage.getItem(POS)||'null');return v&&Number.isFinite(v.x)&&Number.isFinite(v.y)?v:null;}catch{return null;}}
function guardarPos(x,y){try{localStorage.setItem(POS,JSON.stringify({x:Math.round(x),y:Math.round(y)}));}catch{}}
function dentro(box,x,y){const w=box.offsetWidth,h=box.offsetHeight;return [Math.max(0,Math.min(x,innerWidth-w)),Math.max(0,Math.min(y,innerHeight-h))];}
function ubicar(){const box=$('pv256Panel');if(!box||box.hidden||!map)return;const r=map.getContainer().getBoundingClientRect();
 box.style.maxHeight=Math.max(220,Math.min(r.height-24,innerHeight-24))+'px';const g=leerPos();
 // Posición inicial (V-2.59): arriba, a la izquierda de los botones del encabezado (libera la esquina del botón Pantalla completa).
 let x0=r.right-12-box.offsetWidth,y0=r.top+56;const marca=document.querySelector('header .pe2101-brand'),acts=document.querySelector('header .actions');
 if(marca&&acts){const bR=marca.getBoundingClientRect().right,aL=acts.getBoundingClientRect().left;if(aL-bR>=box.offsetWidth+20){x0=Math.max(bR+10,aL-box.offsetWidth-50);y0=10;}}
 const [x,y]=dentro(box,g?g.x:x0,g?g.y:y0);box.style.left=x+'px';box.style.top=y+'px';}
function arrastre(box){const head=box.querySelector('.pv256-head');let o=null;
 head.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const b=box.getBoundingClientRect();o={dx:e.clientX-b.left,dy:e.clientY-b.top,id:e.pointerId};head.setPointerCapture(e.pointerId);box.classList.add('moviendo');e.preventDefault();});
 head.addEventListener('pointermove',e=>{if(!o||e.pointerId!==o.id)return;const [x,y]=dentro(box,e.clientX-o.dx,e.clientY-o.dy);box.style.left=x+'px';box.style.top=y+'px';});
 const fin=e=>{if(!o||e.pointerId!==o.id)return;o=null;box.classList.remove('moviendo');guardarPos(parseFloat(box.style.left),parseFloat(box.style.top));};
 head.addEventListener('pointerup',fin);head.addEventListener('pointercancel',fin);
 addEventListener('resize',()=>{if(box.hidden)return;const [x,y]=dentro(box,parseFloat(box.style.left)||0,parseFloat(box.style.top)||0);box.style.left=x+'px';box.style.top=y+'px';});}

/* ---------- Guardar / cargar ---------- */
async function guardar(){await P.guardarPreventivo(datos);}
function habilitar(){$('pv256Toggle').disabled=!datos.meses.length;}
async function cargar(file,p){
 P.ocupado(true);const btn=$('pv256Load');btn.classList.add('busy');
 try{const xml=await leerArchivo(file);const r=extraer(xml,file.name);asegurarMes(p);
  r.arbol.forEach(a=>a.p=p);r.brazos.forEach(b=>b.p=p);
  const ya=new Set(datos.brazos.map(huella));let nuevos=0,repetidos=0;
  for(const a of r.arbol)if(!datos.arbol.some(x=>x.p===p&&x.cluster===a.cluster&&x.nivel===a.nivel))datos.arbol.push(a);
  for(const b of r.brazos){const h=huella(b);if(ya.has(h)){repetidos++;continue;}ya.add(h);datos.brazos.push(b);nuevos++;}
  if(nuevos){const f=datos.archivos.find(x=>x.p===p&&x.nombre===file.name);if(f)f.n+=nuevos;else datos.archivos.push({p,nombre:file.name,n:nuevos,cargado:new Date().toISOString()});}
  await guardar();habilitar();abiertos.add(idA(p.slice(0,4)));abiertos.add(idM(p));if(!visible)mostrar(true);else{dibujar();panel();}
  aviso(`${file.name} → ${mesLargo(p)}\n${nuevos} brazos nuevos dibujados · ${repetidos} ya estaban cargados en ese mes${r.ignorados?` · ${r.ignorados} elementos que no son líneas no se dibujan`:''}.`);
 }catch(e){aviso('No se pudo cargar el archivo: '+e.message);}
 finally{P.ocupado(false);btn.classList.remove('busy');$('pv256File').value='';}
}
function opcionesAnio(sel){const y0=new Date().getFullYear();const ys=new Set([...anios().map(Number),y0-1,y0,y0+1,y0+2]);return [...ys].sort().map(y=>`<option${y===sel?' selected':''}>${y}</option>`).join('');}
function elegirMes(titulo,boton,defP){return new Promise(res=>{const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog pv257-mes';const y=Number(defP.slice(0,4)),m=Number(defP.slice(5,7));
 d.innerHTML=`<h2></h2><label>Año<select class="a">${opcionesAnio(y)}</select></label><label>Mes<select class="m">${MESES.map((x,i)=>`<option value="${i+1}"${i+1===m?' selected':''}>${x}</option>`).join('')}</select></label><p class="pv257-nota">Se acomoda solo en orden de calendario.</p><div><button type="button" class="no">Cancelar</button><button type="button" class="ok"></button></div>`;
 d.querySelector('h2').textContent=titulo;d.querySelector('.ok').textContent=boton;
 const fin=v=>{d.close();d.remove();res(v);};d.querySelector('.no').onclick=()=>fin(null);d.querySelector('.ok').onclick=()=>fin(d.querySelector('.a').value+'-'+String(d.querySelector('.m').value).padStart(2,'0'));
 d.addEventListener('cancel',e=>{e.preventDefault();fin(null);});document.body.append(d);d.showModal();});}
let periodoPendiente=null;
async function agregar(){const p=await elegirMes('Agregar año o mes','Agregar',hoyP());if(!p)return;
 if(datos.meses.includes(p)){aviso(`${mesLargo(p)} ya existe.`);return;}asegurarMes(p);await guardar();habilitar();abiertos.add(idA(p.slice(0,4)));if(!visible)mostrar(true);else panel();}

/* ---------- Borrar: árbol con selección por clic ---------- */
function ancestros(id){const [t,...r]=partes(id);if(t==='b'){const b=datos.brazos[Number(r[0])];return [idA(b.p.slice(0,4)),idM(b.p),idCl(b.p,b.cluster),idNv(b.p,b.cluster,b.nivel),idF(b.p,b.src)];}
 const p=r[0];const out=t==='a'?[]:[idA(p.slice(0,4))];if(t==='c'||t==='n'||t==='f')out.push(idM(p));if(t==='n')out.push(idCl(p,r[1]));return out;}
function cubre(padre,hijo){const [t,...r]=partes(padre),[th,...rh]=partes(hijo);if(padre===hijo)return true;
 if(th==='b'){const b=datos.brazos[Number(rh[0])];rh.splice(0,1,b.p);}
 const ph=rh[0]||'';if(t==='a')return ph.startsWith(r[0]+'-');if(t==='m')return ph===r[0];if(t==='c')return ph===r[0]&&rh[1]===r[1]&&(th!=='f');if(t==='n')return ph===r[0]&&rh[1]===r[1]&&rh[2]===r[2];return false;}
async function ventanaBorrar(){
 const selN=new Set(),selB=new Set(),ab=new Set(abiertos);
 const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog pv257-borrar';
 d.innerHTML='<h2>Borrar de Mtto Preventivo</h2><p class="pv257-nota">Flechita ▸ despliega · clic selecciona (con todo lo de adentro) · otro clic lo quita.</p><div class="pv257-arbol pv256-tree"></div><p class="pv257-resumen"></p><div><button type="button" class="no">Cancelar</button><button type="button" class="si" disabled>Borrar</button></div>';
 const esSel=id=>{if(selN.has(id)||ancestros(id).some(a=>selN.has(a)))return true;const ids=brazosDe(id);const [t]=partes(id);return t==='b'?selB.has(ids[0]):ids.length>0&&ids.every(i=>selB.has(i));};
 const pintar=()=>{d.querySelector('.pv257-arbol').innerHTML=arbolHtml((id,txt,cls,cuenta,flecha)=>filaHtml(id,txt,cls,cuenta,flecha,'',esSel(id)?'borrar':'',false),ab,true);
  const meses=datos.meses.filter(p=>selN.has(idM(p))||selN.has(idA(p.slice(0,4))));const nb=selB.size;
  d.querySelector('.pv257-resumen').textContent=nb||meses.length?`Vas a borrar: ${nb} brazo${nb===1?'':'s'}${meses.length?` · ${meses.length} mes${meses.length===1?'':'es'} (${meses.map(mesLargo).join(', ')})`:''}.`:'Selecciona lo que quieres borrar.';
  d.querySelector('.si').disabled=!nb&&!meses.length&&![...selN].some(x=>x.startsWith('c'+sep));};
 d.addEventListener('click',e=>{const tog=e.target.closest('[data-tog]');if(tog){const id=tog.dataset.tog;ab.has(id)?ab.delete(id):ab.add(id);pintar();return;}
  const row=e.target.closest('.pv256-row[data-id]');if(!row)return;const id=row.dataset.id;const ids=brazosDe(id);
  if(esSel(id)){ids.forEach(i=>selB.delete(i));selN.delete(id);ancestros(id).forEach(a=>selN.delete(a));[...selN].forEach(x=>{if(cubre(id,x))selN.delete(x);});}
  else{if(partes(id)[0]!=='b')selN.add(id);ids.forEach(i=>selB.add(i));}
  pintar();});
 document.body.append(d);pintar();d.showModal();
 const ok=await new Promise(res=>{d.querySelector('.no').onclick=()=>res(false);d.querySelector('.si').onclick=()=>res(true);d.addEventListener('cancel',e=>{e.preventDefault();res(false);});});
 const resumen=d.querySelector('.pv257-resumen').textContent;d.close();d.remove();
 if(!ok||!await confirmar(resumen+'\n¿Seguro? No se puede deshacer.\nMasivos y coberturas no se tocan.'))return;
 const fuera=new Set(datos.meses.filter(p=>selN.has(idM(p))||selN.has(idA(p.slice(0,4)))));
 const mapa=new Map(),nuevos=[];datos.brazos.forEach((b,k)=>{if(!selB.has(k)&&!fuera.has(b.p)){mapa.set(k,nuevos.length);nuevos.push(b);}});
 datos.brazos=nuevos;datos.meses=datos.meses.filter(p=>!fuera.has(p));
 const quedan=new Set(nuevos.map(b=>b.p+sep+b.cluster+sep+b.nivel));
 datos.arbol=datos.arbol.filter(a=>!fuera.has(a.p)&&!selN.has(idCl(a.p,a.cluster))&&(a.nivel==null||quedan.has(a.p+sep+a.cluster+sep+a.nivel)));
 datos.archivos=datos.archivos.filter(f=>!fuera.has(f.p)).map(f=>({...f,n:nuevos.filter(b=>b.p===f.p&&b.src===f.nombre).length})).filter(f=>f.n>0);
 encendidos=new Set([...encendidos].filter(k=>mapa.has(k)).map(k=>mapa.get(k)));resaltado=null;
 await guardar();habilitar();dibujar();panel();
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
  box.innerHTML='<div class="pv256-head"><b>Mtto Preventivo</b><span class="pv256-legend"><i class="lg-primaria"></i>Primaria<i class="lg-secundaria"></i>Secundaria<i class="lg-distribucion"></i>Distribución</span><button type="button" id="pv256Close" aria-label="Cerrar">×</button></div><div id="pv256Tree" class="pv256-tree"></div><div class="pv257-acciones"><button type="button" id="pv257Agregar">+ Agregar año o mes</button><button type="button" id="pv257Borrar">Borrar…</button></div>';
  document.body.append(box);arrastre(box);
  box.addEventListener('click',e=>{const tog=e.target.closest('[data-tog]');if(tog){const id=tog.dataset.tog;abiertos.has(id)?abiertos.delete(id):abiertos.add(id);panel();return;}
   const kmz=e.target.closest('[data-kmz]');if(kmz){periodoPendiente=kmz.dataset.kmz;$('pv256File').click();return;}
   const row=e.target.closest('.pv256-row');if(row)clicFila(row.dataset.id);});
  box.addEventListener('keydown',e=>{const row=e.target.closest('.pv256-row');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();clicFila(row.dataset.id);}});
  $('pv256Close').onclick=()=>mostrar(false);$('pv257Agregar').onclick=agregar;$('pv257Borrar').onclick=ventanaBorrar;
  listoDatos=P.cargarPreventivo().then(v=>{if(v&&Array.isArray(v.brazos)){datos=migrar(v);}$('pv256Toggle').disabled=false;}).catch(e=>console.warn('Mtto Preventivo:',e));
 }
};
function botones(){
 const acts=document.querySelector('header .actions'),cov=document.querySelector('header .coverage-load');
 if(acts&&!$('pv256Load')){const l=document.createElement('label');l.className='btn orange pv256-load';l.id='pv256Load';l.innerHTML='Mtto Preventivo<input type="file" id="pv256File" accept=".kmz,.kml" hidden>';(cov?cov.after(l):acts.prepend(l));
  l.addEventListener('click',e=>{if(e.target!==$('pv256File'))periodoPendiente=null;});
  $('pv256File').addEventListener('change',async e=>{const f=e.target.files[0];let p=periodoPendiente;periodoPendiente=null;if(!f)return;
   if(!p)p=await elegirMes('¿A qué mes pertenece este KMZ?','Cargar',hoyP());if(p)cargar(f,p);else $('pv256File').value='';});}
 const ver=$('coverageToggle');
 if(ver&&!$('pv256Toggle')){const b=document.createElement('button');b.type='button';b.id='pv256Toggle';b.className='btn pv256-toggle';b.setAttribute('aria-pressed','false');b.textContent='Ver Preventivo';ver.after(b);
  b.addEventListener('click',()=>mostrar(!visible));}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',botones,{once:true});else botones();
})();
