/* Planta Externa V-2.59 · Botón "Pantalla completa" en la esquina superior derecha del mapa.
   Al presionarlo el mapa ocupa toda la pantalla y el botón cambia a "Salir"; "Salir" o Esc lo regresan a su tamaño.
   No toca masivos, filtros, coberturas, Mtto Preventivo ni Cambio de cierres. */
(()=>{'use strict';
let map=null,btn=null,activo=false;
const txt=()=>{btn.innerHTML=activo?'<span aria-hidden="true">✕</span> Salir':'<span aria-hidden="true">⛶</span> Pantalla completa';btn.setAttribute('aria-pressed',String(activo));btn.title=activo?'Regresar el mapa a su tamaño normal (Esc)':'Ver el mapa en pantalla completa';};
function ajustar(){if(!map)return;const c=map.getCenter(),z=map.getZoom();setTimeout(()=>{map.invalidateSize({pan:false});map.setView(c,z,{animate:false});},60);}
function entrar(){activo=true;document.body.classList.add('pe259-full');txt();ajustar();
 const el=document.documentElement;if(el.requestFullscreen&&!document.fullscreenElement)el.requestFullscreen().catch(()=>{});}
function salir(){activo=false;document.body.classList.remove('pe259-full');txt();ajustar();if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&activo)salir();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activo&&!document.querySelector('dialog[open]'))salir();});
const prev=window.initCoverageV53;
window.initCoverageV53=function(leafletMap){
 try{prev&&prev(leafletMap);}finally{
  map=leafletMap;const ctl=L.control({position:'topright'});
  ctl.onAdd=()=>{const d=L.DomUtil.create('div','pe259-ctl');btn=L.DomUtil.create('button','pe259-btn',d);btn.type='button';txt();
   L.DomEvent.disableClickPropagation(d);L.DomEvent.on(btn,'click',()=>activo?salir():entrar());return d;};
  ctl.addTo(map);
 }
};
})();
