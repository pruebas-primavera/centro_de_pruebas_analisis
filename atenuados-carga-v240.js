/* Atenuados V-2.40 · Carga local de XLSX en Worker, por lotes, hacia la IndexedDB propia del módulo.
   Base: primavera-atenuados-bases-v1 (misma clave que V-2.39). Sin solicitudes de red. */
function at240Worker(){
'use strict';
let cancelled=false,db,file,entries,loadId,kind,totalBytes=0,doneBytes=0,stage='',records=0,textCount=0,lastReport=0;
const DB='primavera-atenuados-bases-v1',decoder=new TextDecoder('utf-8',{fatal:true});
const cancelCheck=()=>{if(cancelled)throw Error('CANCELLED');};
function progress(force=false){const now=Date.now();if(force||now-lastReport>180){lastReport=now;postMessage({type:'progress',stage,records,textCount,readBytes:doneBytes,totalBytes});}}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta',{keyPath:'kind'});r.result.createObjectStore('chunks',{keyPath:['id','part']});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('Cierra otras pestañas de Atenuados e intenta de nuevo.'));});}
function transaction(store,action){return new Promise((res,rej)=>{const t=db.transaction(store,'readwrite');t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('Guardado interrumpido'));try{action(t.objectStore(store));}catch(e){t.abort();rej(e);}});}
async function removeChunks(id){if(!id)return;await transaction('chunks',s=>{const r=s.openCursor(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};});}
function entities(s){return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v]);}
function attrs(s){const a={};for(const m of s.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))a[m[1]]=entities(m[2]??m[3]);return a;}
function col(ref){let n=0;for(const ch of ref){if(ch<'A'||ch>'Z')break;n=n*26+ch.charCodeAt(0)-64;}return n-1;}
async function bytes(start,size){return new DataView(await file.slice(start,start+size).arrayBuffer());}
async function directory(){
 const tailStart=Math.max(0,file.size-65557),tail=await bytes(tailStart,file.size-tailStart);let e=-1;
 for(let p=tail.byteLength-22;p>=0;p--)if(tail.getUint32(p,true)===0x06054b50&&p+22+tail.getUint16(p+20,true)===tail.byteLength){e=p;break;}
 if(e<0)throw Error('No se encontró un archivo XLSX/ZIP válido.');
 if(tail.getUint16(e+4,true)||tail.getUint16(e+6,true))throw Error('No se admiten archivos ZIP divididos.');
 const count=tail.getUint16(e+10,true),size=tail.getUint32(e+12,true),offset=tail.getUint32(e+16,true);
 if(count===65535||size===0xffffffff||offset===0xffffffff)throw Error('Este lector todavía no admite ZIP64.');
 if(size>16*1024*1024||offset+size>file.size)throw Error('Directorio XLSX inválido.');
 const d=await bytes(offset,size),map=new Map();let p=0;
 for(let i=0;i<count;i++){
  if(p+46>d.byteLength||d.getUint32(p,true)!==0x02014b50)throw Error('Directorio XLSX dañado.');
  const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true),compressed=d.getUint32(p+20,true),uncompressed=d.getUint32(p+24,true),len=d.getUint16(p+28,true),extra=d.getUint16(p+30,true),comment=d.getUint16(p+32,true),local=d.getUint32(p+42,true);
  if(p+46+len+extra+comment>d.byteLength)throw Error('Entrada XLSX truncada.');
  const name=decoder.decode(new Uint8Array(d.buffer,p+46,len));
  if(flags&1)throw Error('El archivo está cifrado. Selecciona un XLSX sin contraseña.');
  if([compressed,uncompressed,local].includes(0xffffffff))throw Error('ZIP64 no está disponible.');
  if(map.has(name))throw Error('El archivo contiene entradas duplicadas.');
  map.set(name,{name,method,compressed,uncompressed,local,crc:d.getUint32(p+16,true)});p+=46+len+extra+comment;
 }
 return map;
}
const crcTable=(()=>{const a=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;a[i]=c>>>0;}return a;})();
async function xml(name,token){
 const entry=entries.get(name);if(!entry)throw Error('Falta '+name+' en el archivo.');
 const h=await bytes(entry.local,30);if(h.getUint32(0,true)!==0x04034b50)throw Error('Cabecera XLSX dañada.');
 const begin=entry.local+30+h.getUint16(26,true)+h.getUint16(28,true);if(begin+entry.compressed>file.size)throw Error('Contenido XLSX incompleto.');
 let stream=file.slice(begin,begin+entry.compressed).stream();
 if(entry.method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('Este navegador no ofrece descompresión incremental. Prueba con Chrome o Edge actualizado.');}}
 else if(entry.method!==0)throw Error('Método de compresión no compatible.');
 const reader=stream.getReader(),td=new TextDecoder('utf-8',{fatal:true});let buffer='',crc=0xffffffff,size=0;const stack=[];
 try{
  for(;;){cancelCheck();const {value,done}=await reader.read();if(done)break;
   size+=value.length;if(size>entry.uncompressed||size>2*1024**3)throw Error('Tamaño descomprimido inválido.');
   for(let i=0;i<value.length;i++)crc=crcTable[(crc^value[i])&255]^(crc>>>8);
   doneBytes+=value.length;buffer+=td.decode(value,{stream:true});let pos=0;
   while(pos<buffer.length){
    if(buffer[pos]!=='<'){const end=buffer.indexOf('<',pos);if(end<0)break;const s=buffer.slice(pos,end);if(s){const r=token('text',entities(s));if(r?.then)await r;}pos=end;continue;}
    let end;
    if(buffer.startsWith('<!--',pos)){end=buffer.indexOf('-->',pos+4);if(end<0)break;pos=end+3;continue;}
    if(buffer.startsWith('<![CDATA[',pos)){end=buffer.indexOf(']]>',pos+9);if(end<0)break;const r=token('text',buffer.slice(pos+9,end));if(r?.then)await r;pos=end+3;continue;}
    if(buffer.startsWith('<!',pos))throw Error('Declaración XML no compatible.');
    let quote='';end=pos+1;for(;end<buffer.length;end++){const ch=buffer[end];if(quote){if(ch===quote)quote='';}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}
    if(end===buffer.length)break;
    const raw=buffer.slice(pos+1,end);pos=end+1;if(raw[0]==='?')continue;
    const close=raw[0]==='/',self=/\/\s*$/.test(raw),full=raw.replace(/^\//,'').match(/^([^\s/]+)/)?.[1];if(!full)throw Error('Etiqueta XML inválida.');
    const tag=full.split(':').pop();
    if(close){if(stack.pop()!==full)throw Error('XML incompleto o mal formado.');const r=token('end',tag);if(r?.then)await r;}
    else{if(!self)stack.push(full);let r=token('start',tag,attrs(raw.slice(full.length)));if(r?.then)await r;if(self){r=token('end',tag);if(r?.then)await r;}}
   }
   buffer=buffer.slice(pos);if(buffer.length>16*1024*1024)throw Error('Una celda o etiqueta es demasiado grande.');progress();
  }
  buffer+=td.decode();if(buffer.trim()||stack.length)throw Error('El XML terminó antes de completar sus datos.');
  if(size!==entry.uncompressed||((crc^0xffffffff)>>>0)!==entry.crc)throw Error('La verificación de integridad del XLSX falló.');
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function smallXML(name){const out=[];return xml(name,(ev,tag,a)=>{if(ev==='start')out.push({tag,...a});}).then(()=>out);}
async function execute(msg){
 // V-2.49: cada paquete se guarda cifrado con la llave del día (AES-256-GCM). Sin llave no se guarda nada.
 if(!msg.key||!msg.k||!msg.m)throw Error('Abre Atenuados con la contraseña del día antes de cargar bases.');
 const C250=at250Cripto(),llave=msg.key,kdia=msg.k,maestra=msg.m;
 file=msg.file;kind=msg.kind;loadId=msg.id;const start=Date.now(),rules=at240Rules(),cutoff=kind==='matriz'?null:rules.cut(file.name);db=await openDB();
 if(kind==='potencias'){const other=await new Promise((res,rej)=>{const r=db.transaction('meta').objectStore('meta').get('clientes');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});if(other?.cutoff&&cutoff<other.cutoff)throw Error('Base de potencias desactualizada. La base de potencias es anterior a la base de clientes. Carga una base de potencias más reciente para continuar.');}
 entries=await directory();
 const sheets=(await smallXML('xl/workbook.xml')).filter(x=>x.tag==='sheet');
 if(sheets.length!==1)throw Error('El archivo debe tener una sola hoja de datos. El libro contiene '+sheets.length+' hojas.');
 const rels=await smallXML('xl/_rels/workbook.xml.rels'),rel=rels.find(x=>x.tag==='Relationship'&&x.Id===sheets[0]['r:id']);
 if(!rel)throw Error('No se localizó la hoja de datos.');
 let sheet=rel.Target.startsWith('/')?rel.Target.slice(1):'xl/'+rel.Target;
 sheet=sheet.split('/').reduce((a,p)=>{if(p==='..')a.pop();else if(p!=='.')a.push(p);return a;},[]).join('/');
 if(!sheet.startsWith('xl/worksheets/')||!entries.has(sheet))throw Error('Ruta de hoja no válida.');
 totalBytes=(entries.get(sheet)?.uncompressed||0)+(entries.get('xl/sharedStrings.xml')?.uncompressed||0);doneBytes=0;
 stage='Leyendo catálogo de textos';progress(true);const ss=[];let inSI=false,inT=false,text='';
 if(entries.has('xl/sharedStrings.xml'))await xml('xl/sharedStrings.xml',(ev,tag)=>{if(ev==='start'){if(tag==='si'){inSI=true;text='';}if(tag==='t'&&inSI)inT=true;}else if(ev==='text'){if(inT)text+=tag;}else{if(tag==='t')inT=false;if(tag==='si'){ss.push(text);textCount++;inSI=false;}}});
 stage='Leyendo y guardando registros';let headers=null,row=[],rowNumber=0,cell=null,capture='',inText=false,batch=[],part=0,blanks=0,clientColumns=null,clientAccounts=new Set(),matrixSeen=new Set(),matrixDuplicates=0,discarded=0;
 const flush=async()=>{if(!batch.length)return;cancelCheck();const data=batch;batch=[];const sealed=await C250.enc(llave,data);const p=part++;await transaction('chunks',s=>s.put({id:loadId,part:p,m:maestra,k:kdia,n:data.length,iv:sealed.iv,ct:sealed.ct}));progress();};
 await xml(sheet,(ev,tag,a)=>{
  if(ev==='start'){
   if(tag==='row'){row=[];rowNumber=Number(a.r);if(!Number.isSafeInteger(rowNumber)||rowNumber<1)throw Error('Fila sin referencia válida.');}
   if(tag==='c'){const i=col(a.r||'');if(i<0||i>16383)throw Error('Columna sin referencia válida.');cell={i,type:a.t,value:'',inline:''};}
   if(cell&&(tag==='v'||tag==='t')){capture=tag;inText=true;}
  }else if(ev==='text'){
   if(cell&&inText){if(capture==='v')cell.value+=tag;else cell.inline+=tag;}
  }else{
   if(tag==='v'||tag==='t')inText=false;
   if(tag==='c'&&cell){let value=cell.type==='inlineStr'?cell.inline:cell.value;if(cell.type==='s'){const n=Number(value);if(!Number.isInteger(n)||n<0||n>=ss.length)throw Error('Referencia de texto no válida.');value=ss[n];}row[cell.i]=value;cell=null;}
   if(tag==='row'){
    if(!row.some(v=>v!==undefined&&v!=='')){blanks++;return;}
    if(kind==='matriz'){
     if(row.slice(1).some(v=>String(v??'').trim()!==''))throw Error('La matriz debe contener una sola columna A: PUERTO. Fila '+rowNumber+'.');
     const value=rules.key(row[0]);
     if(!headers){headers=['PUERTO'];if(value.toUpperCase()==='PUERTO'){progress(true);return;}}
     const loc=rules.matrixLocation(value);if(!loc)throw Error('Matriz con datos incompletos o formato inválido. Fila '+rowNumber+'. Ejemplo: BUGAMBILIAS_GDL 0/4/6.');
     if(matrixSeen.has(loc.id)){matrixDuplicates++;return;}matrixSeen.add(loc.id);
     batch.push({excelRow:rowNumber,values:[value]});records++;if(batch.length>=1000)return flush();
    }else if(!headers){headers=Array.from({length:row.length},(_,i)=>row[i]??'');const names=headers.map(v=>String(v).trim().toLowerCase());if(!names.includes('cuenta')||!names.includes('olt'))throw Error('No se encontraron los encabezados Cuenta y OLT.');clientColumns=rules.columns(headers,kind);progress(true);}
    else{
     if(row.length>headers.length)throw Error('La fila '+rowNumber+' tiene datos fuera de los encabezados.');
     if(kind==='clientes'){
      const account=rules.account(row[clientColumns.account]);
      if(!account){discarded++;return;}                               // Regla 10: sin cuenta válida se descarta
      if(!rules.location(row,clientColumns))throw Error('Archivo de clientes con ubicación incompleta, favor de corregirlo. Fila '+rowNumber+'.');
      if(clientAccounts.has(account))throw Error('Cuenta repetida en la base de clientes: '+account+'. Corrige la base antes de cargarla.');
      clientAccounts.add(account);
     }
     batch.push({excelRow:rowNumber,values:Array.from({length:headers.length},(_,i)=>row[i]??'')});records++;if(batch.length>=1000)return flush();
    }
   }
  }
 });
 await flush();cancelCheck();if(!headers||records===0)throw Error('El archivo no contiene registros de datos.');
 stage='Verificando registros guardados';progress(true);
 const saved=await new Promise((resolve,reject)=>{const tx=db.transaction('chunks');let n=0;const r=tx.objectStore('chunks').openCursor(IDBKeyRange.bound([loadId,0],[loadId,Number.MAX_SAFE_INTEGER]));r.onsuccess=()=>{const c=r.result;if(c){n+=c.value.n;c.continue();}};tx.oncomplete=()=>resolve(n);tx.onerror=()=>reject(tx.error);});
 if(saved!==records)throw Error('El conteo guardado no coincide con el leído.');cancelCheck();
 const result={matrixDuplicates,discarded,cutoff,validationVersion:240,kind,id:loadId,name:file.name,sheet:sheets[0].name,headers,count:records,parts:part,blankRows:blanks,seconds:Math.round((Date.now()-start)/100)/10,date:new Date().toISOString()};
 // Un único cambio de metadatos activa la base completa. Las otras bases no se tocan.
 await transaction('meta',s=>s.put(result));postMessage({type:'complete',result});db.close();db=null;
}
self.onmessage=async e=>{if(e.data.type==='cancel'){cancelled=true;return;}if(e.data.type!=='start')return;try{await execute(e.data);}catch(err){const cancelledError=cancelled||err.message==='CANCELLED';if(db){try{await removeChunks(loadId);}catch{}db.close();db=null;}postMessage({type:cancelledError?'cancelled':'error',message:cancelledError?'Carga cancelada. La base anterior se conserva.':err.name==='QuotaExceededError'?'No hay espacio suficiente en el almacenamiento del navegador. La base anterior se conserva.':err.message});}};
}
(()=>{'use strict';
const $=id=>document.getElementById(id),DB='primavera-atenuados-bases-v1';let db,busy=false,currentWorker=null,currentId=null,stopped=false;
const fmt=n=>Number(n||0).toLocaleString('es-MX');
const changes=typeof BroadcastChannel==='function'?new BroadcastChannel('primavera-atenuados-bases-v240'):null;changes?.addEventListener('message',()=>refresh());
window.addEventListener('at250-desbloqueado',()=>refresh());window.addEventListener('at250-bloqueo',()=>{currentWorker?.terminate();currentWorker=null;});
// Pide al navegador conservar las bases aunque falte espacio (no garantiza, pero evita borrados automáticos).
navigator.storage?.persist?.().catch(()=>{});
function request(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function open(){if(db)return db;const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta',{keyPath:'kind'});r.result.createObjectStore('chunks',{keyPath:['id','part']});};db=await request(r);db.onversionchange=()=>{db.close();db=null;};return db;}
async function metadata(){const d=await open();return request(d.transaction('meta').objectStore('meta').getAll());}
async function cleanup(){const d=await open(),live=new Set((await metadata()).map(x=>x.id));return new Promise((res,rej)=>{const t=d.transaction('chunks','readwrite'),s=t.objectStore('chunks'),r=s.openKeyCursor();r.onsuccess=()=>{const c=r.result;if(c){if(!live.has(c.key[0])&&c.key[0]!==currentId)s.delete(c.key);c.continue();}};t.oncomplete=res;t.onerror=()=>rej(t.error);});}
async function refresh(){try{const bases=await metadata();const names={clientes:'Clientes',potencias:'Potencias',matriz:'Matriz'};
 for(const kind of ['clientes','potencias','matriz']){const m=bases.find(b=>b.kind===kind),el=$('at240-'+kind),button=document.querySelector(`[data-load="${kind}"]`);el.textContent=m?`${names[kind]}: ${fmt(m.count)} ${kind==='matriz'?'puertos':'registros'}${kind==='matriz'?'':(' · corte '+(m.cutoff||'sin fecha: vuelve a cargar'))}`:`${names[kind]}: sin base`;el.title=m?`${m.name} · Hoja ${m.sheet}`:'Carga una base para comenzar';button.classList.toggle('is-loaded',!!m);button.setAttribute('aria-label',`${kind==='matriz'?'Carga de matriz':'Cargar '+kind}${m?' · Base cargada':''}`);button.title=m?'Base cargada: '+m.name:'Sin base cargada';}
 const clearBtn=$('at240-clear-bases');if(clearBtn)clearBtn.disabled=busy||!bases.length;
 window.dispatchEvent(new CustomEvent('at240-bases-changed',{detail:{bases,busy}}));
 }catch(e){$('at240-storage-note').textContent='Almacenamiento no disponible: '+e.message;window.dispatchEvent(new CustomEvent('at240-storage-error',{detail:e.message}));}}

const dialog=$('at240-upload');dialog.addEventListener('cancel',e=>e.preventDefault());
// V-2.49 · H1: borra de este navegador SOLO las bases de Excel de Atenuados (matriz, clientes, potencias).
// Usa el mismo candado de cargas para no borrar mientras se carga o analiza en otra pestaña. No toca otros módulos.
$('at240-clear-bases')?.addEventListener('click',async()=>{
 if(busy)return;
 const bases=await metadata().catch(()=>[]);if(!bases.length)return;
 const names={matriz:'Matriz',clientes:'Clientes',potencias:'Potencias'};
 const list=bases.map(b=>`• ${names[b.kind]||b.kind}: ${fmt(b.count)} ${b.kind==='matriz'?'puertos':'registros'}`).join('\n');
 if(!confirm('¿Borrar de este navegador las bases de Atenuados?\n\n'+list+'\n\nTendrás que volver a cargarlas para usar el módulo. Los demás módulos no se modifican.'))return;
 try{
  if(!navigator.locks)throw Error('El navegador no permite coordinar el borrado entre pestañas. Prueba con Chrome o Edge.');
  await navigator.locks.request('primavera-atenuados-import-v1',{ifAvailable:true},async lock=>{
   if(!lock)throw Error('Hay una carga o análisis de Atenuados en curso en otra pestaña. Espera a que termine.');
   const d=await open();
   await new Promise((res,rej)=>{const t=d.transaction(['meta','chunks'],'readwrite');t.objectStore('meta').clear();t.objectStore('chunks').clear();t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('Borrado cancelado'));});
   const left=await new Promise((res,rej)=>{const t=d.transaction(['meta','chunks']),a=t.objectStore('meta').count(),b=t.objectStore('chunks').count();t.oncomplete=()=>res(a.result+b.result);t.onerror=()=>rej(t.error);});
   if(left)throw Error('No se pudo confirmar el borrado completo: quedan '+left+' registros.');
  });
  changes?.postMessage('bases-updated');
  alert('Bases de Atenuados borradas de este navegador.');
  location.reload();
 }catch(e){alert('No se borraron las bases: '+e.message);}
});
function show(kind,file){$('at240-upload-title').textContent=`Atenuados · Carga de ${kind}`;$('at240-upload-heading').textContent='Procesando archivo Excel…';$('at240-upload-stage').textContent='Preparando lectura…';$('at240-upload-detail').classList.remove('is-error');$('at240-upload-detail').textContent=file.name+' · '+(file.size/1e6).toFixed(2)+' MB';$('at240-upload-fill').style.width='0%';$('at240-upload-track').setAttribute('aria-valuenow','0');$('at240-upload-percent').textContent='0 %';$('at240-upload-accept').disabled=true;$('at240-upload-cancel').disabled=false;dialog.classList.remove('is-finished');dialog.showModal();$('at240-upload-cancel').focus();}
function finish(type,message){if(busy)window.AT250?.ocupado(false);busy=false;currentWorker?.terminate();currentWorker=null;currentId=null;$('at240-upload-accept').disabled=false;$('at240-upload-cancel').disabled=true;dialog.classList.add('is-finished');dialog.dataset.result=type;$('at240-upload-heading').textContent=type==='complete'?'Carga completada':type==='cancelled'?'Carga cancelada':'No se completó la carga';$('at240-upload-stage').textContent=type==='complete'?'Lectura, guardado y verificación terminados.':'La base anterior se conserva.';$('at240-upload-detail').textContent=message;$('at240-upload-detail').classList.toggle('is-error',type==='error');if(type==='complete'){$('at240-upload-fill').style.width='100%';$('at240-upload-percent').textContent='100 %';$('at240-upload-track').setAttribute('aria-valuenow','100');}else $('at240-upload-percent').textContent=type==='cancelled'?'Cancelada':'Interrumpida';$('at240-upload-accept').focus();refresh();}
async function begin(kind,file){
 if(busy)return;if(!window.AT250?.key){alert('Abre Atenuados con la contraseña del día.');return;}busy=true;window.AT250.ocupado(true);window.dispatchEvent(new CustomEvent('at240-import-start'));stopped=false;show(kind,file);
 try{
  if(!file.name.toLowerCase().endsWith('.xlsx'))throw Error('Selecciona un archivo .xlsx.');if(kind!=='matriz')at240Rules().cut(file.name);
  if(!window.Worker||!window.indexedDB||!window.DecompressionStream)throw Error('Este navegador no ofrece las funciones necesarias. Prueba con Chrome o Edge actualizado.');
  try{new DecompressionStream('deflate-raw');}catch{throw Error('No está disponible la descompresión incremental. Prueba con Chrome o Edge actualizado.');}
  if(!navigator.locks)throw Error('El navegador no permite coordinar cargas seguras entre pestañas en esta dirección. Prueba con Chrome o Edge.');
  await navigator.locks.request('primavera-atenuados-import-v1',{ifAvailable:true},async lock=>{
   if(!lock)throw Error('Hay otra carga o análisis de Atenuados en otra pestaña. Espera a que termine.');
   if(stopped){finish('cancelled','Carga cancelada antes de comenzar.');return;}
   await open();await cleanup();
   if(navigator.storage?.estimate){const s=await navigator.storage.estimate();if(s.quota&&s.quota-(s.usage||0)<file.size*4)throw Error('El navegador no tiene suficiente espacio disponible para esta carga.');}
   if(stopped){finish('cancelled','Carga cancelada antes de comenzar.');return;}
   currentId=crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
   await new Promise(resolve=>{
    const url=URL.createObjectURL(new Blob([at240Rules.toString()+';'+at250Cripto.toString()+';('+at240Worker.toString()+')()'],{type:'text/javascript'}));
    try{currentWorker=new Worker(url);}catch(e){URL.revokeObjectURL(url);throw e;}URL.revokeObjectURL(url);
    currentWorker.onerror=e=>{finish('error','No se pudo ejecutar el proceso de lectura: '+(e.message||'el navegador lo bloqueó'));resolve();};
    currentWorker.onmessage=async e=>{const m=e.data;if(m.type==='progress'){
     $('at240-upload-stage').textContent=m.stage;const p=m.totalBytes?Math.min(99,Math.floor(100*m.readBytes/m.totalBytes)):0;$('at240-upload-fill').style.width=p+'%';$('at240-upload-percent').textContent=p+' %';$('at240-upload-track').setAttribute('aria-valuenow',String(p));$('at240-upload-detail').textContent=`${file.name}\n${fmt(m.records)} registros procesados\n${fmt(m.textCount)} textos de catálogo\nEl 100 % se marca solo al verificar el guardado.`;
    }else if(m.type==='complete'){changes?.postMessage('bases-updated');const r=m.result;finish('complete',`${r.name}\n${fmt(r.count)} registros cargados\n${r.headers.length} columnas · Hoja: ${r.sheet}\nTiempo: ${r.seconds} s\nGuardado local verificado.${r.cutoff?' Fecha de corte: '+r.cutoff+'.':''}${r.discarded?' '+fmt(r.discarded)+' registro(s) sin cuenta válida descartado(s).':''}${r.matrixDuplicates?' '+fmt(r.matrixDuplicates)+' puertos repetidos omitidos.':''} Pulsa Análisis cuando las tres bases estén listas.`);await cleanup().catch(()=>{});resolve();}
    else if(m.type==='error'||m.type==='cancelled'){finish(m.type,m.message);await cleanup().catch(()=>{});resolve();}};
    currentWorker.postMessage({type:'start',kind,id:currentId,file,key:window.AT250.key,k:window.AT250.fecha,m:window.AT250.maestra});
   });
  });
 }catch(e){finish('error',e.message);}
}
for(const kind of ['clientes','potencias','matriz']){const b=document.querySelector(`[data-load="${kind}"]`);b.onclick=()=>{if(busy)return;const input=$('at240-file');input.value='';input.onchange=()=>{if(input.files[0])begin(kind,input.files[0]);};input.click();};}
$('at240-upload-accept').onclick=()=>{if(!busy)dialog.close();};$('at240-upload-cancel').onclick=()=>{stopped=true;$('at240-upload-cancel').disabled=true;$('at240-upload-stage').textContent='Cancelando y retirando la carga incompleta…';if(currentWorker)currentWorker.postMessage({type:'cancel'});};
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});refresh();
})();
