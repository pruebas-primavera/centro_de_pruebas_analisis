/* Navegación exclusiva de la tarjeta nueva. No consulta bases de otros módulos.
   V-2.49: abre Atenuados con un pase de un solo uso (60 s) para que solo se entre desde la Bienvenida. */
(()=>{'use strict';const button=document.getElementById('welcomeAttenuated');if(button)button.addEventListener('click',()=>{
 let hash='';try{const a=new Uint8Array(18);crypto.getRandomValues(a);const t=btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');localStorage.setItem('primavera-entrada-atenuados',JSON.stringify({t,ts:Date.now()}));hash='#e='+t;}catch{}
 window.open('atenuados.html'+hash,'_blank','noopener');});})();
