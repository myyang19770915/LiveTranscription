/* Keeps the screen awake while a session runs (screen-awake). The browser takes the lock back whenever the
   tab is hidden, so it is asked for again on return; no API or a refusal is not an error. */
(function(root){
  function create(nav,doc){
    let wanted=false,lock=null,asking=false;
    async function ask(){
      if(!wanted||lock||asking||!nav.wakeLock||doc.visibilityState!=='visible')return;
      asking=true;
      try{
        const got=await nav.wakeLock.request('screen');
        if(!wanted){got.release().catch(()=>{});return}   // the session ended while the browser was answering
        lock=got;
        got.addEventListener?.('release',()=>{if(lock===got)lock=null});
      }catch{}finally{asking=false}
    }
    doc.addEventListener('visibilitychange',ask);
    return {
      hold(){wanted=true;return ask()},
      release(){wanted=false;const held=lock;lock=null;return held?held.release().catch(()=>{}):Promise.resolve()},
    };
  }
  root.ScreenAwake={create};
  if(typeof module!=='undefined')module.exports=root.ScreenAwake;
})(typeof globalThis!=='undefined'?globalThis:this);
