// review.js's real retranslate(): a retranslation that finishes after the segment changed must not overwrite it
// (transcript-review "Concurrent edits are detected"). Runs the function itself with a fake model and a fake API
// that refuses an old version like the server does. node bench/reviewcheck.js; exits 1 on any FAIL.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../webapp/static/review.js'),'utf8');
const start=src.indexOf('async function retranslate('),end=src.indexOf('\nasync function saveEdit',start);
if(start<0||end<0)throw new Error('retranslate() not found in review.js');
const code=src.slice(start,end);

function harness(){
  const env={segments:[{seq:1,version:4,source:'原文一',target:'舊譯文'}],posted:[],notes:new Map()};
  let finish;
  const model=new Promise(resolve=>{finish=text=>resolve({text,source:'zh'})});
  const deps={
    segments:env.segments,meeting:{language:'zh',targetLanguage:'zh'},meetingId:'m1',notes:env.notes,
    $:()=>({checked:false,hidden:true}),render:()=>{},finals:()=>[],
    bySeq:seq=>env.segments.find(s=>s.seq===seq),
    replace:segment=>{env.segments[0]=segment},
    TranslationContext:{refinementRequest:()=>({body:{},neighbours:[]}),translateStream:()=>model,
      plausibleRefinement:()=>true,labelled:text=>text},
    call:async(method,url,body)=>{   // like the server: an old version is refused with 409 and the segment reloaded
      env.posted.push(body);
      if(body.version!==env.segments[0].version){const error=new Error('stale');error.stale=true;throw error}
      return {...env.segments[0],version:body.version+1,target:body.target};
    },
  };
  const retranslate=new Function(...Object.keys(deps),`${code}\nreturn retranslate;`)(...Object.values(deps));
  return {env,retranslate,finish,deps};
}

let failed=0;
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);if(!ok)failed++;
  console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)};

(async()=>{
  // Spec example "what a finished retranslation does", one row each.
  {const {env,retranslate,finish}=harness();const running=retranslate(1,false);
    finish('新譯文');await running;
    t('unchanged: saved with the version at start',env.posted.map(b=>b.version),[4]);
    t('unchanged: segment saved',[env.segments[0].version,env.segments[0].target],[5,'新譯文'])}
  {const {env,retranslate,finish}=harness();const running=retranslate(1,false);
    env.segments[0]={...env.segments[0],version:5,source:'原文二'};   // edited again while translating
    finish('舊原文的譯文');await running;
    t('changed: nothing sent',env.posted.length,0);
    t('changed: newer text kept',[env.segments[0].version,env.segments[0].source,env.segments[0].target],[5,'原文二','舊譯文']);
    t('changed: notice shown',env.notes.get(1)?.text,'原文已再次修改，略過這次重譯')}
  {const {env,retranslate,finish}=harness();const running=retranslate(1,false);
    env.segments[0]={...env.segments[0],version:5};                  // confirmed by someone else, same text
    finish('新譯文');await running;
    t('confirmed elsewhere: sent with the version at start',env.posted.map(b=>b.version),[4]);
    t('confirmed elsewhere: refused, not overwritten',env.segments[0].target,'舊譯文');
    t('confirmed elsewhere: the note says so',env.notes.get(1)?.text,'這段已重新載入，未套用這次重譯')}
  {const {env,retranslate,deps}=harness();   // edited to B, then to C; C's retranslation finishes before B's
    const answers=[];
    deps.TranslationContext.translateStream=()=>new Promise(resolve=>answers.push(text=>resolve({text,source:'zh'})));
    env.segments[0]={...env.segments[0],version:5,source:'原文B'};const forB=retranslate(1,false);
    env.segments[0]={...env.segments[0],version:6,source:'原文C'};const forC=retranslate(1,false);
    answers[1]('C 的譯文');await forC;
    answers[0]('B 的譯文');await forB;
    t('older retranslation finishing last: the newer result stays',[env.segments[0].source,env.segments[0].target],['原文C','C 的譯文']);
    t('older retranslation finishing last: the newer note stays',env.notes.get(1)?.text,'已重譯')}
  if(failed)process.exitCode=1;
})();
