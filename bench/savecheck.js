// app.js segment saving: a failed save is shown and retried after 5, 15, 30, then 60 s; 401 stops; another meeting
// stops the retries (meeting-timeline "Unsaved segments are shown and retried"). Runs the real code with a fake fetch
// and fake timers. node bench/savecheck.js; exits 1 on any FAIL.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../webapp/static/app.js'),'utf8');
const begin='// --- Segment saving (segment-save-retry) ---',finish='// --- End segment saving ---';
const start=src.indexOf(begin),end=src.indexOf(finish);
let failed=0;
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);if(!ok)failed++;
  console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)};
if(start<0||end<0){t('segment saving block found in app.js',false,true);process.exitCode=1;return}

function page(){
  const element={textContent:'',className:'',hidden:true};
  const env={
    records:[{source:'第一句',target:'S1',startMs:0,endMs:900}],recorder:null,segmentSaveTimer:null,
    requests:[],answers:[],timers:[],saved:[],
    finalizedRecords(){return env.records},outputRecords(){return env.records},   // what the meeting keeps (quality-pass)
    $:id=>id==='saveState'?element:{value:''},
    direction:{source:'zh',target:'en'},learnedTerms:'',
    window:{MeetingSeries:{saved:(id,n)=>env.saved.push([id,n])}},
    console:{warn(){}},
    fetch:(url,options)=>{env.requests.push({url,body:JSON.parse(options.body)});
      const answer=env.answers.shift()||'ok';
      return answer==='down'?Promise.reject(new Error('network')):Promise.resolve({ok:answer==='ok',status:answer==='ok'?200:answer})},
    setTimeout:(fn,ms)=>{env.timers.push({fn,ms});return env.timers.length},
    clearTimeout:id=>{if(id&&env.timers[id-1])env.timers[id-1].cleared=true},
    Date,
  };
  const api=new Function('env',`with(env){${src.slice(start,end)}\nreturn {sendSegments,unsavedSegments,ownSegments,leavingLosesData};}`)(env);
  api.ownSegments('m1');
  return {env,element,api};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const nextRetry=env=>{const timer=env.timers.filter(x=>!x.cleared).at(-1);timer.cleared=true;return timer};

(async()=>{
  // Spec example "retry schedule": 1-4 failures in a row, then success.
  {const {env,element,api}=page();
    env.answers=['down',503,'down','down','ok'];
    t('nothing sent yet: leaving loses nothing',api.leavingLosesData(),false);
    api.sendSegments('m1');await settle();
    t('a save failed: leaving asks',api.leavingLosesData(),true);
    const shown=[],waits=[];
    for(let i=0;i<4;i++){shown.push([element.textContent,element.className]);const timer=nextRetry(env);waits.push(timer.ms);
      if(i===1)env.records=[...env.records,{source:'第二句',target:'S2',startMs:900,endMs:1800}];   // finalized meanwhile
      timer.fn();await settle()}
    t('retry after 5, 15, 30, 60 s',waits,[5000,15000,30000,60000]);
    t('shown while failing',shown,[['段落尚未儲存，5 秒後重試','save-state warn'],['段落尚未儲存，15 秒後重試','save-state warn'],
      ['段落尚未儲存，30 秒後重試','save-state warn'],['段落尚未儲存，60 秒後重試','save-state warn']]);
    t('the retries send the latest segments',env.requests.map(r=>r.body.segments.length),[1,1,2,2,2]);
    t('saved: shown with the time',/^段落已儲存 \d{2}:\d{2}:\d{2}$/.test(element.textContent)&&element.className==='save-state',true);
    t('saved: nothing left to save',api.unsavedSegments(),false);
    t('saved: leaving loses nothing',api.leavingLosesData(),false);
    env.segmentSaveTimer=1;t('a save waiting for its timer: leaving asks',api.leavingLosesData(),true);env.segmentSaveTimer=null;
    env.recorder={};t('recording: leaving asks',api.leavingLosesData(),true);env.recorder=null;
    t('saved: no retry pending',env.timers.filter(x=>!x.cleared).length,0)}
  // 401: stop retrying and say so.
  {const {env,element,api}=page();
    env.answers=[401];api.sendSegments('m1');await settle();
    t('401: no retry',env.timers.filter(x=>!x.cleared).length,0);
    t('401: shown',[element.textContent,element.className],['登入已失效，段落尚未儲存，請重新登入','save-state warn']);
    t('401: still unsaved (leaving asks)',api.leavingLosesData(),true);
    env.answers=['down'];api.sendSegments('m1');await settle();   // the 10-second save goes on and fails
    t('401 then a failure: still no retry',env.timers.filter(x=>!x.cleared).length,0);
    t('401 then a failure: still says sign in',element.textContent,'登入已失效，段落尚未儲存，請重新登入')}
  // Another meeting started: the old meeting's retry sends nothing, and its failure is no longer shown.
  {const {env,api}=page();
    env.answers=['down'];api.sendSegments('m1');await settle();
    api.ownSegments('m2');   // the next meeting started and cleared the old segments
    t('another meeting: the old retry is cancelled',env.timers.filter(x=>!x.cleared).length,0);
    api.sendSegments('m1');await settle();
    t('another meeting: the retry sends nothing',env.requests.length,1);
    t('another meeting: the old failure is cleared',api.unsavedSegments(),false)}
  // A late answer for the previous meeting does not touch the new meeting's state.
  for(const answer of ['down',401,'ok']){
    const {env,element,api}=page();
    let release;env.fetch=(url,options)=>{env.requests.push({url,body:JSON.parse(options.body)});
      return new Promise((resolve,reject)=>{release=()=>answer==='down'?reject(new Error('network')):resolve({ok:answer==='ok',status:answer==='ok'?200:answer})})};
    api.sendSegments('m1');api.ownSegments('m2');release();await settle();
    t(`late ${answer} for the previous meeting: nothing shown`,[element.textContent,element.hidden],['',true]);
    t(`late ${answer} for the previous meeting: no retry`,env.timers.filter(x=>!x.cleared).length,0);
    t(`late ${answer} for the previous meeting: nothing unsaved`,api.unsavedSegments(),false);
  }
  if(failed)process.exitCode=1;
})();
