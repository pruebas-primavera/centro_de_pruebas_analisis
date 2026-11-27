/* Planta Externa V-2.59 · Cambio de cierres (V-2.58; V-2.59 corrige la posición de los triángulos).
   - "Cambio de cierres" carga un KMZ con estructura obligatoria Año › Mes › Coto (si no la trae, no se carga y avisa qué falta).
   - Dentro de cada coto: cada punto = cierre, renombrado Cierre_1 … Cierre_N en el orden del archivo; al complementar, los nuevos
     siguen la numeración (no se renumera). Sin duplicados: mismo mes, coto y coordenada. Polígono = contorno del coto.
   - Del nombre original solo se guarda el comentario de los NO cambiados (NO SE CAMBIÓ / SOLO MANTENIMIENTO / EXISTENTE…).
   - Colores: cierre cambiado = rombo verde; no cambiado = rombo azul; coto = contorno amarillo (2) con relleno aqua al 50 %.
   - "Ver cierres cambiados": panel movible con árbol Año › Mes › Coto › Cierre (clic prende/apaga, selección múltiple) y "Borrar…".
   - Cifrado con PE253 (registro 'cierres'). No toca masivos, filtros, coberturas, Mtto Preventivo ni exportes. */
(()=>{'use strict';
const P=window.PE253;const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const MESES=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const CORTOS=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const mesTxt=p=>MESES[Number(p.slice(5,7))-1]||p,mesLargo=p=>mesTxt(p).charAt(0)+mesTxt(p).slice(1).toLowerCase()+' '+p.slice(0,4);
function mesDe(nombre){const u=norm(nombre).replace(/SETIEMBRE/g,'SEPTIEMBRE');for(let i=0;i<12;i++)if(new RegExp('(^|[^A-Z])'+MESES[i]+'([^A-Z]|$)').test(u))return i+1;
 for(let i=0;i<12;i++)if(new RegExp('(^|[^A-Z])'+CORTOS[i]+'([^A-Z]|$)').test(u))return i+1;return 0;}
const NOCAMBIO=/NO SE CAMBI|SOLO|EXISTENTE|MANTENIMI/;
function comentario(nombre){const u=norm(nombre.replace(/_/g,' '));if(!NOCAMBIO.test(u))return '';
 const t=u.replace(/\bCIERR?ES?\b|\bCIERE\b/g,' ').replace(/\b(ALSEK|ALESK|ASLEK|MEGON)\b/g,' ').replace(/\d+/g,' ').replace(/\s+/g,' ').trim();return t?t.charAt(0)+t.slice(1).toLowerCase():'';}
let map=null,capa=null,datos={v:1,meses:[],cotos:[],cierres:[],poligonos:[],archivos:[]},encendidos=new Set(),visible=false,resaltado=null,abiertos=new Set();
const sep='\u0001',idA=y=>'a'+sep+y,idM=p=>'m'+sep+p,idC=(p,c)=>'c'+sep+p+sep+c,idZ=i=>'z'+sep+i,idF=(p,f)=>'f'+sep+p+sep+f,partes=id=>id.split(sep);

/* ---------- Lectura con estructura obligatoria Año › Mes › Coto ---------- */
async function leerArchivo(file){
 if(/\.kml$/i.test(file.name))return file.text();
 if(!window.JSZip)throw Error('No se pudo cargar el lector de KMZ.');
 const zip=await JSZip.loadAsync(file);const kml=Object.values(zip.files).find(f=>!f.dir&&/\.kml$/i.test(f.name));
 if(!kml)throw Error('El KMZ no contiene un archivo KML.');return kml.async('string');
}
function extraer(xml,archivo){
 const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('El archivo KML contiene XML inválido.');
 const hijos=(e,t)=>[...e.children].filter(c=>c.localName===t);const nom=e=>(hijos(e,'name')[0]?.textContent||'').trim();
 const folders=[...doc.getElementsByTagNameNS('*','Folder')];
 const anios=folders.filter(f=>/^\s*(19|20)\d\d\s*$/.test(nom(f)));
 if(!anios.length)throw Error('No encontré la carpeta del AÑO (por ejemplo "2026").\nEl archivo debe venir así: Año › Mes › Nombre del coto.');
 const cierres=[],poligonos=[],errores=[];let ignorados=0;
 for(const fa of anios){const y=nom(fa).trim();
  for(const fm of hijos(fa,'Folder')){const m=mesDe(nom(fm));if(!m){errores.push(`"${nom(fm)}" (dentro de ${y}) no es un mes.`);continue;}
   const p=y+'-'+String(m).padStart(2,'0');
   if(hijos(fm,'Placemark').length)errores.push(`${mesLargo(p)} trae marcadores sueltos fuera de una carpeta de coto.`);
   for(const fc of hijos(fm,'Folder')){const coto=norm(nom(fc))||'(SIN NOMBRE)';
    for(const pm of fc.getElementsByTagNameNS('*','Placemark')){
     const nota=(hijos(pm,'description')[0]?.textContent||'').trim(),orig=nom(pm);
     const pt=pm.getElementsByTagNameNS('*','Point')[0],pg=pm.getElementsByTagNameNS('*','Polygon')[0];
     const coords=e=>(e?.getElementsByTagNameNS('*','coordinates')[0]?.textContent||'').trim().split(/\s+/).map(x=>x.split(',').map(Number)).filter(q=>Number.isFinite(q[0])&&Number.isFinite(q[1])).map(q=>[+q[1].toFixed(7),+q[0].toFixed(7)]);
     if(pt){const c=coords(pt)[0];if(c)cierres.push({p,coto,pt:c,tipo:NOCAMBIO.test(norm(orig.replace(/_/g,' ')))?'nocambio':'cambiado',coment:comentario(orig),nota,src:archivo});else ignorados++;}
     else if(pg){const ob=pg.getElementsByTagNameNS('*','outerBoundaryIs')[0]||pg;const c=coords(ob);if(c.length>=3)poligonos.push({p,coto,pts:c,nota,src:archivo});else ignorados++;}
     else ignorados++;}}}}
 if(!cierres.length&&!poligonos.length)throw Error((errores.length?errores.join('\n')+'\n':'')+'No encontré cotos con cierres dentro de Año › Mes › Coto.');
 return {cierres,poligonos,ignorados,errores};
}
const llaveCierre=c=>[c.p,c.coto,c.pt.join(','),c.occ||1].join('|'),llavePol=g=>[g.p,g.coto,g.pts.map(q=>q.join(',')).join(' ')].join('|');

/* ---------- Árbol ---------- */
const anios=()=>[...new Set(datos.meses.map(p=>p.slice(0,4)))].sort();
const mesesDe=y=>datos.meses.filter(p=>p.startsWith(y+'-')).sort();
const cotosDe=p=>[...new Set(datos.cotos.filter(c=>c.p===p).map(c=>c.coto))].sort((a,b)=>a.localeCompare(b,'es'));
function cierresDe(id){const [t,...r]=partes(id);if(t==='z')return [Number(r[0])];
 return datos.cierres.map((c,i)=>[c,i]).filter(([c])=>t==='a'?c.p.startsWith(r[0]+'-'):t==='m'?c.p===r[0]:t==='c'?c.p===r[0]&&c.coto===r[1]:t==='f'?c.p===r[0]&&c.src===r[1]:false).map(([,i])=>i).sort((a,b)=>datos.cierres[a].n-datos.cierres[b].n);}
const cotosEn=id=>{const [t,...r]=partes(id);return datos.cotos.filter(c=>t==='a'?c.p.startsWith(r[0]+'-'):t==='m'?c.p===r[0]:t==='c'?c.p===r[0]&&c.coto===r[1]:false).map(c=>c.p+sep+c.coto);};
function estado(id){const ids=cierresDe(id),cs=cotosEn(id);const tot=ids.length+cs.length;if(!tot)return 'vacio';
 const on=ids.filter(i=>encendidos.has('z'+sep+i)).length+cs.filter(k=>encendidos.has('c'+sep+k)).length;return on===0?'apagado':on===tot?'prendido':'parcial';}

/* ---------- Dibujo ---------- */
// Triángulo (escala de ícono 1.0 como en Google Earth ≈ 26 px), centrado en la coordenada como en Google Earth. Verde = cambiado, azul = no se cambió, mitad y mitad = ambos en el mismo punto.
const TRI={cambiado:'#22c55e',nocambio:'#1e5bff'};
function icono(tipo,sel,n,lbl){const fill=tipo==='mixto'?'url(#cz258mix)':TRI[tipo];
 const svg=`<svg class="cz258-tri${sel?' sel':''}" viewBox="0 0 26 24" width="26" height="24" aria-hidden="true"><polygon points="13,2 24.5,22 1.5,22" fill="${fill}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><polygon points="13,0 26,23.5 0,23.5" fill="none" stroke="#0b1430" stroke-width=".8" stroke-linejoin="round" opacity=".7"/></svg>`;
 return L.divIcon({className:'cz258-ico',html:svg+(n>1?`<b class="cz258-num">${n}</b>`:'')+`<span class="cz258-lbl">${esc(lbl||'')}</span>`,iconSize:[26,24],iconAnchor:[13,12],tooltipAnchor:[0,-12],popupAnchor:[0,-12]});}
function defs(){if($('cz258Defs'))return;const d=document.createElementNS('http://www.w3.org/2000/svg','svg');d.id='cz258Defs';d.setAttribute('width','0');d.setAttribute('height','0');d.style.position='absolute';
 d.innerHTML='<defs><linearGradient id="cz258mix" x1="0" x2="1" y1="0" y2="0"><stop offset="50%" stop-color="#22c55e"/><stop offset="50%" stop-color="#1e5bff"/></linearGradient></defs>';document.body.append(d);}
function dibujar(){
 if(!map)return;capa.clearLayers();if(!visible)return;const sel=resaltado?new Set(cierresDe(resaltado)):new Set();
 for(const g of datos.poligonos){if(!encendidos.has('c'+sep+g.p+sep+g.coto))continue;
  L.polygon(g.pts,{pane:'cierres258pol',color:'#ffd400',weight:2,opacity:1,fillColor:'#00ffff',fillOpacity:.5,interactive:false}).addTo(capa);}
 const grupos=new Map();datos.cierres.forEach((c,i)=>{if(!encendidos.has('z'+sep+i))return;const k=[c.p,c.coto,c.pt.join(',')].join('|');(grupos.get(k)||grupos.set(k,[]).get(k)).push(i);});
 for(const ids of grupos.values()){ids.sort((a,b)=>datos.cierres[a].n-datos.cierres[b].n);const cs=ids.map(i=>datos.cierres[i]),c=cs[0];
  const tipos=new Set(cs.map(x=>x.tipo)),tipo=tipos.size>1?'mixto':c.tipo;
  const mk=L.marker(c.pt,{pane:'cierres258',icon:icono(tipo,ids.some(i=>sel.has(i)),ids.length,'Cierre_'+cs.map(x=>x.n).join(' · ')),keyboard:false}).addTo(capa);
  mk.bindTooltip(`${cs.map(x=>'Cierre_'+x.n).join(' · ')} · ${esc(c.coto)}`,{direction:'top',className:'cz258-tip'});
  mk.bindPopup(()=>`<div class="cz258-pop">${ids.length>1?`<p class="cz258-varios">${ids.length} cierres en este mismo punto</p>`:''}${cs.map(x=>`<b>Cierre_${x.n}</b><span>${esc(mesLargo(x.p))} › ${esc(x.coto)}</span><span class="t ${x.tipo}">${x.tipo==='cambiado'?'Cambiado':'No se cambió'}</span>${x.coment?`<em>${esc(x.coment)}</em>`:''}${x.nota?`<pre>${esc(x.nota)}</pre>`:''}`).join('<hr>')}</div>`,{maxWidth:320});}
}
function centrar(id){const ids=cierresDe(id);const pts=ids.map(i=>datos.cierres[i].pt);
 for(const k of cotosEn(id)){const [p,c]=k.split(sep);datos.poligonos.filter(g=>g.p===p&&g.coto===c).forEach(g=>pts.push(...g.pts));}
 if(!pts.length)return;const bb=L.latLngBounds(pts);if(bb.isValid())map.fitBounds(bb,{padding:[50,50],maxZoom:18});}

/* ---------- Panel ---------- */
function filaHtml(id,txt,cls,cuenta,flecha,st,sel){return `<div class="pv256-row ${cls} ${st}${sel?' sel':''}" data-id="${esc(id)}" role="button" tabindex="0">${flecha!=null?`<span class="pv256-arrow" data-tog="${esc(id)}">${flecha?'▾':'▸'}</span>`:'<span class="pv256-arrow"></span>'}<span class="pv256-chk"></span><span class="pv256-txt">${esc(txt)}</span>${cuenta!=null?`<small>${cuenta}</small>`:''}</div>`;}
function arbolHtml(fila,ab,conArchivos){let h='';
 for(const y of anios()){const ia=idA(y),oa=ab.has(ia);h+=fila(ia,y,'r-an',cierresDe(ia).length,oa,'');if(!oa)continue;h+='<div class="pv256-sub">';
  for(const p of mesesDe(y)){const im=idM(p),om=ab.has(im),cs=cotosDe(p),fs=datos.archivos.filter(f=>f.p===p);
   h+=fila(im,mesTxt(p),'r-mes'+(cierresDe(im).length?'':' gris'),cierresDe(im).length,cs.length||(conArchivos&&fs.length)?om:null);if(!om)continue;h+='<div class="pv256-sub">';
   for(const c of cs){const ic=idC(p,c),oc=ab.has(ic),ids=cierresDe(ic);h+=fila(ic,c,'cl cz258-coto',ids.length,ids.length?oc:null);
    if(oc)h+=`<div class="pv256-sub">${ids.map(i=>{const z=datos.cierres[i];return fila(idZ(i),'Cierre_'+z.n,'cz258-cierre cz-'+z.tipo,null,null);}).join('')}</div>`;}
   if(conArchivos&&fs.length){const ik='k'+sep+p,ok=ab.has(ik);h+=`<div class="pv256-row r-arch" data-tog="${esc(ik)}"><span class="pv256-arrow">${ok?'▾':'▸'}</span><span class="pv257-ico">📄</span><span class="pv256-txt">Archivos</span><small>${fs.length}</small></div>`;
    if(ok)h+=`<div class="pv256-sub">${fs.map(f=>fila(idF(p,f.nombre),f.nombre,'r-file',cierresDe(idF(p,f.nombre)).length+' cierres',null)).join('')}</div>`;}
   h+='</div>';}
  h+='</div>';}
 return h;}
function panel(){if(!$('cz258Panel'))return;
 $('cz258Tree').innerHTML=arbolHtml((id,txt,cls,cuenta,flecha)=>filaHtml(id,txt,cls,cuenta,flecha,estado(id),resaltado===id),abiertos,false)||'<p class="pv256-vacio">Carga un KMZ con el botón Cambio de cierres (Año › Mes › Coto).</p>';
 $('cz258Borrar').disabled=!datos.meses.length;}
function clicFila(id){const ids=cierresDe(id),cs=cotosEn(id);if(!ids.length&&!cs.length)return;
 if(estado(id)==='prendido'){ids.forEach(i=>encendidos.delete('z'+sep+i));cs.forEach(k=>encendidos.delete('c'+sep+k));if(resaltado===id)resaltado=null;}
 else{ids.forEach(i=>encendidos.add('z'+sep+i));cs.forEach(k=>encendidos.add('c'+sep+k));resaltado=id;centrar(id);}
 dibujar();panel();}
function mostrar(on){visible=on;$('cz258Toggle').setAttribute('aria-pressed',String(on));$('cz258Panel').hidden=!on;dibujar();panel();if(on)ubicar();}
/* Ventana movible */
const POS='primavera-cz258-posicion';
function leerPos(){try{const v=JSON.parse(localStorage.getItem(POS)||'null');return v&&Number.isFinite(v.x)&&Number.isFinite(v.y)?v:null;}catch{return null;}}
function guardarPos(x,y){try{localStorage.setItem(POS,JSON.stringify({x:Math.round(x),y:Math.round(y)}));}catch{}}
function dentro(box,x,y){return [Math.max(0,Math.min(x,innerWidth-box.offsetWidth)),Math.max(0,Math.min(y,innerHeight-box.offsetHeight))];}
function ubicar(){const box=$('cz258Panel');if(!box||box.hidden||!map)return;const r=map.getContainer().getBoundingClientRect();
 box.style.maxHeight=Math.max(220,Math.min(r.height-24,innerHeight-24))+'px';const g=leerPos();const [x,y]=dentro(box,g?g.x:r.left+60,g?g.y:r.top+12);box.style.left=x+'px';box.style.top=y+'px';}
function arrastre(box){const head=box.querySelector('.pv256-head');let o=null;
 head.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const b=box.getBoundingClientRect();o={dx:e.clientX-b.left,dy:e.clientY-b.top,id:e.pointerId};head.setPointerCapture(e.pointerId);box.classList.add('moviendo');e.preventDefault();});
 head.addEventListener('pointermove',e=>{if(!o||e.pointerId!==o.id)return;const [x,y]=dentro(box,e.clientX-o.dx,e.clientY-o.dy);box.style.left=x+'px';box.style.top=y+'px';});
 const fin=e=>{if(!o||e.pointerId!==o.id)return;o=null;box.classList.remove('moviendo');guardarPos(parseFloat(box.style.left),parseFloat(box.style.top));};
 head.addEventListener('pointerup',fin);head.addEventListener('pointercancel',fin);
 addEventListener('resize',()=>{if(box.hidden)return;const [x,y]=dentro(box,parseFloat(box.style.left)||0,parseFloat(box.style.top)||0);box.style.left=x+'px';box.style.top=y+'px';});}

/* ---------- Cargar ---------- */
const guardar=()=>P.guardarCierres(datos);
function asegurar(p,coto){if(!datos.meses.includes(p)){datos.meses.push(p);datos.meses.sort();}if(!datos.cotos.some(c=>c.p===p&&c.coto===coto))datos.cotos.push({p,coto});}
async function cargar(file){
 P.ocupado(true);const btn=$('cz258Load');btn.classList.add('busy');
 try{const r=extraer(await leerArchivo(file),file.name);
  const ya=new Set(datos.cierres.map(llaveCierre)),yaPol=new Set(datos.poligonos.map(llavePol));let nuevos=0,repetidos=0;const porMes=new Map(),occ=new Map();
  // Dos o más cierres en la misma coordenada del mismo coto son cierres distintos (se numeran todos y se marcan con un número en el mapa).
  for(const c of r.cierres){const k=[c.p,c.coto,c.pt.join(',')].join('|');occ.set(k,(occ.get(k)||0)+1);c.occ=occ.get(k);}
  for(const c of r.cierres){asegurar(c.p,c.coto);const k=llaveCierre(c);if(ya.has(k)){repetidos++;continue;}ya.add(k);
   c.n=datos.cierres.filter(x=>x.p===c.p&&x.coto===c.coto).reduce((m,x)=>Math.max(m,x.n),0)+1;datos.cierres.push(c);nuevos++;porMes.set(c.p,(porMes.get(c.p)||0)+1);}
  for(const g of r.poligonos){asegurar(g.p,g.coto);const k=llavePol(g);if(!yaPol.has(k)){yaPol.add(k);datos.poligonos.push(g);}}
  for(const [p,n] of porMes){const f=datos.archivos.find(x=>x.p===p&&x.nombre===file.name);if(f)f.n+=n;else datos.archivos.push({p,nombre:file.name,n,cargado:new Date().toISOString()});}
  await guardar();$('cz258Toggle').disabled=false;[...porMes.keys()].forEach(p=>{abiertos.add(idA(p.slice(0,4)));});
  if(!visible)mostrar(true);else{dibujar();panel();}
  aviso(`${file.name}\n${nuevos} cierres nuevos · ${repetidos} ya estaban cargados${[...porMes].length?'\n'+[...porMes].map(([p,n])=>`${mesLargo(p)}: ${n}`).join(' · '):''}${r.ignorados?`\n${r.ignorados} elementos que no son punto ni polígono no se dibujan.`:''}${r.errores.length?'\n\nNo se cargó:\n'+r.errores.join('\n'):''}`);
 }catch(e){aviso('No se pudo cargar el archivo:\n'+e.message);}
 finally{P.ocupado(false);btn.classList.remove('busy');$('cz258File').value='';}}

/* ---------- Borrar ---------- */
function ancestros(id){const [t,...r]=partes(id);if(t==='z'){const c=datos.cierres[Number(r[0])];return [idA(c.p.slice(0,4)),idM(c.p),idC(c.p,c.coto),idF(c.p,c.src)];}
 const p=r[0];const out=t==='a'?[]:[idA(p.slice(0,4))];if(t==='c'||t==='f')out.push(idM(p));return out;}
function cubre(padre,hijo){if(padre===hijo)return true;const [t,...r]=partes(padre),[th,...rh]=partes(hijo);if(th==='z')return false;const ph=rh[0]||'';
 if(t==='a')return ph.startsWith(r[0]+'-');if(t==='m')return ph===r[0]&&th!=='m';if(t==='c')return false;return false;}
async function ventanaBorrar(){
 const selN=new Set(),selB=new Set(),ab=new Set(abiertos);
 const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog pv257-borrar';
 d.innerHTML='<h2>Borrar cierres cambiados</h2><p class="pv257-nota">Flechita ▸ despliega · clic selecciona (con todo lo de adentro) · otro clic lo quita.</p><div class="pv257-arbol pv256-tree"></div><p class="pv257-resumen"></p><div><button type="button" class="no">Cancelar</button><button type="button" class="si" disabled>Borrar</button></div>';
 const esSel=id=>{if(selN.has(id)||ancestros(id).some(a=>selN.has(a)))return true;const ids=cierresDe(id);return partes(id)[0]==='z'?selB.has(ids[0]):ids.length>0&&ids.every(i=>selB.has(i));};
 const mesesFuera=()=>datos.meses.filter(p=>selN.has(idM(p))||selN.has(idA(p.slice(0,4))));
 const cotosFuera=()=>datos.cotos.filter(c=>!mesesFuera().includes(c.p)&&selN.has(idC(c.p,c.coto)));
 const pintar=()=>{d.querySelector('.pv257-arbol').innerHTML=arbolHtml((id,txt,cls,cuenta,flecha)=>filaHtml(id,txt,cls,cuenta,flecha,esSel(id)?'borrar':'',false),ab,true);
  const ms=mesesFuera(),cs=cotosFuera(),nb=selB.size;
  d.querySelector('.pv257-resumen').textContent=nb||ms.length||cs.length?`Vas a borrar: ${nb} cierre${nb===1?'':'s'}${cs.length?` · ${cs.length} coto${cs.length===1?'':'s'}`:''}${ms.length?` · ${ms.length} mes${ms.length===1?'':'es'} (${ms.map(mesLargo).join(', ')})`:''}.`:'Selecciona lo que quieres borrar.';
  d.querySelector('.si').disabled=!nb&&!ms.length&&!cs.length;};
 d.addEventListener('click',e=>{const tog=e.target.closest('[data-tog]');if(tog){const id=tog.dataset.tog;ab.has(id)?ab.delete(id):ab.add(id);pintar();return;}
  const row=e.target.closest('.pv256-row[data-id]');if(!row)return;const id=row.dataset.id,ids=cierresDe(id);
  if(esSel(id)){ids.forEach(i=>selB.delete(i));selN.delete(id);ancestros(id).forEach(a=>selN.delete(a));[...selN].forEach(x=>{if(cubre(id,x))selN.delete(x);});}
  else{if(partes(id)[0]!=='z')selN.add(id);ids.forEach(i=>selB.add(i));}
  pintar();});
 document.body.append(d);pintar();d.showModal();
 const ok=await new Promise(res=>{d.querySelector('.no').onclick=()=>res(false);d.querySelector('.si').onclick=()=>res(true);d.addEventListener('cancel',e=>{e.preventDefault();res(false);});});
 const resumen=d.querySelector('.pv257-resumen').textContent,ms=new Set(mesesFuera()),cs=new Set(cotosFuera().map(c=>c.p+sep+c.coto));d.close();d.remove();
 if(!ok||!await confirmar(resumen+'\n¿Seguro? No se puede deshacer.\nMasivos, coberturas y Mtto Preventivo no se tocan.'))return;
 const mapa=new Map(),nuevos=[];datos.cierres.forEach((c,k)=>{if(!selB.has(k)&&!ms.has(c.p)&&!cs.has(c.p+sep+c.coto)){mapa.set(k,nuevos.length);nuevos.push(c);}});
 datos.cierres=nuevos;datos.meses=datos.meses.filter(p=>!ms.has(p));
 datos.cotos=datos.cotos.filter(c=>!ms.has(c.p)&&!cs.has(c.p+sep+c.coto)&&(nuevos.some(z=>z.p===c.p&&z.coto===c.coto)||datos.poligonos.some(g=>g.p===c.p&&g.coto===c.coto)));
 const vivos=new Set(datos.cotos.map(c=>c.p+sep+c.coto));datos.poligonos=datos.poligonos.filter(g=>vivos.has(g.p+sep+g.coto));
 datos.archivos=datos.archivos.filter(f=>!ms.has(f.p)).map(f=>({...f,n:nuevos.filter(c=>c.p===f.p&&c.src===f.nombre).length})).filter(f=>f.n>0);
 encendidos=new Set([...encendidos].map(k=>{const [t,v]=k.split(sep);return t==='z'?(mapa.has(Number(v))?'z'+sep+mapa.get(Number(v)):null):k;}).filter(Boolean).filter(k=>k[0]!=='c'||vivos.has(k.slice(2))));resaltado=null;
 await guardar();dibujar();panel();}
function aviso(t){const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog';d.innerHTML='<h2>Cambio de cierres</h2><p style="white-space:pre-line"></p><div><button type="button">Aceptar</button></div>';d.querySelector('p').textContent=t;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();}
function confirmar(t){return new Promise(res=>{const d=document.createElement('dialog');d.className='msg-dialog pv256-dialog';d.innerHTML='<h2>Cambio de cierres</h2><p style="white-space:pre-line"></p><div><button type="button" class="no">Cancelar</button><button type="button" class="si">Borrar</button></div>';d.querySelector('p').textContent=t;
 const fin=v=>{d.close();d.remove();res(v);};d.querySelector('.no').onclick=()=>fin(false);d.querySelector('.si').onclick=()=>fin(true);d.addEventListener('cancel',e=>{e.preventDefault();fin(false);});document.body.append(d);d.showModal();});}

/* ---------- Arranque ---------- */
const prev=window.initCoverageV53;
window.initCoverageV53=function(leafletMap){
 try{prev&&prev(leafletMap);}finally{
  map=leafletMap;const etq=()=>map.getContainer().classList.toggle('cz258-sin-etiqueta',map.getZoom()<19);map.on('zoomend',etq);etq();map.createPane('cierres258pol').style.zIndex='350';map.createPane('cierres258').style.zIndex='640';capa=L.layerGroup().addTo(map);
  const box=document.createElement('div');box.id='cz258Panel';box.className='cz258-panel';box.hidden=true;
  box.innerHTML='<div class="pv256-head"><b>Cierres cambiados</b><span class="pv256-legend"><i class="cz258-rombo cambiado"></i>Cambiado<i class="cz258-rombo nocambio"></i>No se cambió<i class="cz258-coto-lg"></i>Coto</span><button type="button" id="cz258Close" aria-label="Cerrar">×</button></div><div id="cz258Tree" class="pv256-tree"></div><div class="pv257-acciones"><button type="button" id="cz258Borrar">Borrar…</button></div>';
  document.body.append(box);arrastre(box);defs();
  box.addEventListener('click',e=>{const tog=e.target.closest('[data-tog]');if(tog){const id=tog.dataset.tog;abiertos.has(id)?abiertos.delete(id):abiertos.add(id);panel();return;}
   const row=e.target.closest('.pv256-row[data-id]');if(row)clicFila(row.dataset.id);});
  box.addEventListener('keydown',e=>{const row=e.target.closest('.pv256-row[data-id]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();clicFila(row.dataset.id);}});
  $('cz258Close').onclick=()=>mostrar(false);$('cz258Borrar').onclick=ventanaBorrar;
  P.cargarCierres().then(v=>{if(v&&Array.isArray(v.cierres))datos={v:1,meses:v.meses||[],cotos:v.cotos||[],cierres:v.cierres,poligonos:v.poligonos||[],archivos:v.archivos||[]};$('cz258Toggle').disabled=!datos.meses.length;}).catch(e=>console.warn('Cambio de cierres:',e));
 }
};
function botones(){
 const ref=$('pv256Load')||document.querySelector('header .coverage-load'),acts=document.querySelector('header .actions');
 if(acts&&!$('cz258Load')){const l=document.createElement('label');l.className='btn orange cz258-load';l.id='cz258Load';l.innerHTML='Cambio de cierres<input type="file" id="cz258File" accept=".kmz,.kml" hidden>';(ref?ref.after(l):acts.prepend(l));
  $('cz258File').addEventListener('change',e=>{const f=e.target.files[0];if(f)cargar(f);});}
 const ver=$('pv256Toggle')||$('coverageToggle');
 if(ver&&!$('cz258Toggle')){const b=document.createElement('button');b.type='button';b.id='cz258Toggle';b.className='btn pv256-toggle cz258-toggle';b.disabled=true;b.setAttribute('aria-pressed','false');b.textContent='Ver cierres cambiados';ver.after(b);b.addEventListener('click',()=>mostrar(!visible));}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',botones,{once:true});else botones();
})();
