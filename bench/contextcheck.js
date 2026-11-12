// translation-context.js must build exactly the request app.js's correctNext() built inline before it
// was extracted (the reference below is that code, unchanged), so live refinement does not change.
const C=require('../webapp/static/translation-context.js');
function inline(finals,record,transcript,direction,glossary,learned,refine){
  const pair=direction.source==='zh_ja',index=finals.indexOf(record);
  const same=s=>!pair||!record.detected||s.detected===record.detected;
  const history=finals.slice(Math.max(0,index-2),index).filter(same),next=finals[index+1];
  const strip=target=>pair?target.replace(/^\[[^\]]*\]\n/u,''):target;
  return {text:record.source,source:direction.source,target:pair?'zh':direction.target,detected_language:record.detected||'',
    history:history.map(s=>s.source).join('\n'),history_translation:history.map(s=>strip(s.target)).join('\n'),
    following:next&&same(next)?next.source.slice(0,120):transcript.slice(record.end,record.end+120).trim(),glossary,learned,refine};
}
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name);if(!ok)process.exitCode=1};
const span=(source,target,detected,start)=>({source,target,detected,start,end:start+source.length});
const zh=[span('第一句。','First.','',0),span('第二句，','Second,','',4),span('第三句。','Third.','',8),span('第四句。','Fourth.','',12)];
const transcriptZh=zh.map(s=>s.source).join('')+'後面還有一些話。';
for(const i of [0,2,3]){
  const want=inline(zh,zh[i],transcriptZh,{source:'zh',target:'en'},'LINE=耐','MiniMax=迷你max',true);
  const got=C.refinementRequest(zh,i,{source:'zh',target:'en',glossary:'LINE=耐',learned:'MiniMax=迷你max',refine:true,tail:transcriptZh.slice(zh[i].end)}).body;
  t(`zh span ${i}`,got,want);
}
const pair=[span('今日は。','[日文 → 中文]\n今天。','ja',0),span('我們開始吧。','[中文 → 日文]\n始めましょう。','zh',4),span('そうですね。','[日文 → 中文]\n是啊。','ja',10),span('はい。','[日文 → 中文]\n好。','ja',16)];
const transcriptPair=pair.map(s=>s.source).join('');
for(const i of [1,2,3]){
  const want=inline(pair,pair[i],transcriptPair,{source:'zh_ja',target:'zh_ja'},'','',false);
  const got=C.refinementRequest(pair,i,{source:'zh_ja',target:'zh_ja',glossary:'',learned:'',refine:false,tail:transcriptPair.slice(pair[i].end)}).body;
  t(`zh_ja span ${i}`,got,want);
}
t('neighbours are history and next targets',C.refinementRequest(zh,2,{source:'zh',target:'en'}).neighbours,['First.','Second,','Fourth.']);
// Spec "Corrected word": correcting segment 12 sends segments 10 and 11 as history, segment 13's start as following.
const fifteen=Array.from({length:15},(_,i)=>span(`第${i+1}段`+(i===11?'程式設計比賽':''),`Seg ${i+1}`,'',i*10));
const twelve=C.refinementRequest(fifteen,11,{source:'zh',target:'en'}).body;
t('segment 12 history = 10, 11',[twelve.history,twelve.history_translation],['第10段\n第11段','Seg 10\nSeg 11']);
t('segment 12 following = start of 13',twelve.following,'第13段');
t('direction label',C.labelled('好。','ja',true),'[日文 → 中文]\n好。');
