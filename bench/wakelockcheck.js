// Spec screen-awake: "The screen stays awake during a session" — the four scenarios, with a fake browser.
const S=require('../webapp/static/wake-lock.js');
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
function browser({api=true,refuse=false}={}){
  const count={requested:0,released:0},listeners=[],locks=[];
  const doc={visibilityState:'visible',addEventListener:(_,fn)=>listeners.push(fn)};
  const nav=api?{wakeLock:{request:async()=>{
    count.requested++;
    if(refuse)throw new Error('NotAllowedError');
    const handlers=[],lock={release:async()=>{count.released++;handlers.forEach(h=>h())},addEventListener:(_,h)=>handlers.push(h),taken(){handlers.forEach(h=>h())}};
    locks.push(lock);return lock;
  }}}:{};
  const show=async state=>{doc.visibilityState=state;for(const fn of listeners)await fn()};
  return {nav,doc,count,locks,show};
}
(async()=>{
  let b=browser(),awake=S.create(b.nav,b.doc);
  await awake.hold();t('requested at the start',b.count,{requested:1,released:0});
  await awake.hold();t('not requested twice while held',b.count.requested,1);
  await awake.release();t('released at the end',b.count,{requested:1,released:1});

  b=browser();awake=S.create(b.nav,b.doc);
  await awake.hold();
  await b.show('hidden');b.locks[0].taken();   // the browser takes the lock back with the tab hidden
  t('nothing requested while hidden',b.count.requested,1);
  await b.show('visible');t('requested again on return',b.count.requested,2);
  await awake.release();
  await b.show('hidden');await b.show('visible');t('not requested after the session ended',b.count.requested,2);

  b=browser({api:false});awake=S.create(b.nav,b.doc);
  t('no API: hold resolves',await awake.hold().then(()=>'ok',()=>'threw'),'ok');
  t('no API: release resolves',await awake.release().then(()=>'ok',()=>'threw'),'ok');

  b=browser({refuse:true});awake=S.create(b.nav,b.doc);
  t('refused: hold resolves',await awake.hold().then(()=>'ok',()=>'threw'),'ok');
  t('refused: asked once',b.count.requested,1);
})();
