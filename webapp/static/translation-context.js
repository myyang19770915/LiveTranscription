/* How a finalized span is re-translated with its neighbours: the live refinement pass (app.js) and the
   post-meeting review page (review.js) build the same request and apply the same repetition check. */
(function(root){
  const DIRECTION_LABEL=/^\[[^\]]*\]\n/u;
  // finals: finalized spans in order, each {source, target, detected}. options: {source, target, glossary,
  // learned, refine, tail}; tail is the speech after the span, used when the next span is in the other
  // language of 中日雙向 mode (or there is none).
  function refinementRequest(finals,index,options){
    const record=finals[index],pair=options.source==='zh_ja';
    const same=s=>!pair||!record.detected||s.detected===record.detected;
    const history=finals.slice(Math.max(0,index-2),index).filter(same),next=finals[index+1];
    const strip=target=>pair?target.replace(DIRECTION_LABEL,''):target;
    const body={text:record.source,source:options.source,target:pair?'zh':options.target,detected_language:record.detected||'',
      history:history.map(s=>s.source).join('\n'),history_translation:history.map(s=>strip(s.target)).join('\n'),
      following:next&&same(next)?next.source.slice(0,120):(options.tail||'').slice(0,120).trim(),
      glossary:options.glossary||'',learned:options.learned||'',refine:Boolean(options.refine)};
    return {body,neighbours:[...history,next].filter(Boolean).map(s=>s.target)};
  }
  // In 中日雙向 mode a translation carries its direction as a first line.
  function labelled(text,resultSource,pair){return pair?`[${resultSource==='zh'?'中文 → 日文':'日文 → 中文'}]\n${text}`:text}
  // The model sometimes translates the context as well: it repeated the previous span's translation or
  // absorbed the next span ("…before going to large scale…" in both [9] and [10]). Such a refinement is dropped.
  function plausibleRefinement(old,fresh,neighbours){
    const norm=s=>s.replace(DIRECTION_LABEL,'').replace(/[\s\p{P}]/gu,'');
    const before=norm(old),after=norm(fresh);
    if(after.length>before.length*1.5+15)return false;
    return !neighbours.some(n=>{const t=norm(n);return t.length>=12&&[t.slice(0,12),t.slice(-12)].some(piece=>after.includes(piece)&&!before.includes(piece))});
  }
  // POST /api/translate/stream and read its SSE events: each carries the whole text so far (plus the
  // resolved source/target in 中日雙向 mode); an error event or an empty result throws.
  async function translateStream(body,signal){
    const response=await fetch('/api/translate/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'翻譯失敗');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result='',source=body.source,target=body.target;
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))>=0){
        const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
        for(const line of event.split('\n')){if(!line.startsWith('data: '))continue;const data=JSON.parse(line.slice(6));if(data.error)throw new Error(data.error);if(typeof data.text==='string')result=data.text;if(data.source)source=data.source;if(data.target)target=data.target}
      }
    }
    if(!result.trim())throw new Error('翻譯服務沒有回傳內容');
    return {text:result.trim(),source,target};
  }
  root.TranslationContext={refinementRequest,labelled,plausibleRefinement,translateStream};
  if(typeof module!=='undefined')module.exports=root.TranslationContext;
})(typeof globalThis!=='undefined'?globalThis:this);
