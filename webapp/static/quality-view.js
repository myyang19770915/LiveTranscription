/* 精準模式 on the live page (quality-pass). The gateway sends corrected sentences for a time range; they are
   kept, and live text and live finalized translations of that range stop being shown. A failed range keeps
   its live finalized segments instead. Every kept segment gets its sequence number (seq) when it is kept and
   keeps it, so what was saved under a number stays that segment.
   A revision event (quality-revision) replaces the text of kept sentences by id. It can also merge the sentences
   after one into it (revision-merge): those leave the list, and state.merged remembers which seq went into which. */
(function(root){
  const UNAVAILABLE_AFTER=3;
  const LATE_MS=1500;   // live text reaches the page up to ~1.3 s after its audio, so its segment can end that much past a range
  function create(){return {records:[],seq:0,merged:[],throughMs:0,failures:0,done:false,gaps:[],taken:new Set()}}
  const key=s=>s.id||`${s.startMs}:${s.endMs}:${s.source}`;
  // Live finalized segments of a failed range become kept segments, also the ones finalized after the failure was
  // reported. Kept at the end of the list, so earlier positions never change.
  function promote(state,liveFinals){
    for(const s of liveFinals||[]){
      if(state.taken.has(key(s))||!state.gaps.some(gap=>s.endMs>gap.from&&s.endMs<=gap.to+LATE_MS))continue;
      state.taken.add(key(s));
      state.records.push({seq:++state.seq,source:s.source,target:s.target,detected:s.detected||'',startMs:s.startMs||0,endMs:s.endMs||0,live:true});
    }
    return state;
  }
  // liveFinals: the page's finalized live segments in order, each with startMs/endMs/source/target/detected.
  function apply(state,event,liveFinals){
    if(!event||typeof event!=='object')return state;
    if(event.failed){
      // A failed final range has no end: whatever is finalized from here on is kept.
      state.gaps.push({from:state.throughMs,to:event.final?Infinity:Number(event.throughMs)||0});
      promote(state,liveFinals);
      state.throughMs=Math.max(state.throughMs,Number(event.throughMs)||0);
      state.failures++;
    }else{
      promote(state,liveFinals);   // before the new sentences: late segments of an earlier failed range
      for(const s of Array.isArray(event.sentences)?event.sentences:[]){
        if(typeof s?.source!=='string'||typeof s?.target!=='string')continue;
        state.records.push({seq:++state.seq,source:s.source,target:s.target,detected:s.lang||'',startMs:Number(s.startMs)||0,endMs:Number(s.endMs)||0,...(Number.isInteger(s.id)?{id:s.id}:{})});
      }
      state.throughMs=Math.max(state.throughMs,state.records.at(-1)?.endMs||0);
      state.failures=0;
    }
    if(event.final)state.done=true;
    return state;
  }
  // The gateway looked at sentences again with more context: the ones that changed get their new text, and a sentence
  // that was cut in two becomes one (the later parts leave the list). Returns how many sentences changed.
  function revise(state,event){
    let changed=0;
    for(const s of Array.isArray(event?.sentences)?event.sentences:[]){
      if(!Number.isInteger(s?.id)||typeof s.source!=='string'||typeof s.target!=='string'||!s.source.trim()||!s.target.trim())continue;
      const record=state.records.find(r=>r.id===s.id);
      if(!record)continue;
      record.source=s.source;record.target=s.target;changed++;
      if(!Array.isArray(s.merged))continue;
      for(const id of s.merged){
        const at=state.records.findIndex(r=>r.id===id);
        if(!Number.isInteger(id)||at<0||state.records[at]===record)continue;
        state.merged.push({into:record.seq,from:state.records[at].seq});
        state.records.splice(at,1);
      }
      if(Number(s.endMs)>record.endMs)record.endMs=Number(s.endMs);
    }
    return changed;
  }
  // Where the live transcript is still shown from: the end of the last text that arrived by throughMs.
  function liveFrom(state,timeMarks){
    let at=0;
    for(const mark of timeMarks||[]){if(mark.ms>state.throughMs)break;at=mark.end}
    return at;
  }
  // The live chunk that crosses the last kept sentence's end (its time mark is the audio received when it arrived,
  // up to LATE_MS after its own audio) can start with words that sentence already ends with: start after them.
  // Looked for only up to throughMs + LATE_MS, ignoring punctuation and white space, the last 6 down to 3 characters.
  // A repeat can straddle the cut point (「點」 before it, 「進來」 after): the search starts up to 6 characters before
  // the cut point, and only a match that ends after it counts. The first such match: a later one could be new speech
  // that happens to repeat the words (「我們的系統跟我們的客戶」), and "now" could sit inside "know".
  const PUNCT=/[\s\p{P}]/u,REPEAT_MAX=6,REPEAT_MIN=3;
  function skipRepeat(state,transcript,timeMarks,from){
    const core=[...(state.records.at(-1)?.source||'')].filter(c=>!PUNCT.test(c));
    let until=from;
    for(const mark of timeMarks||[]){if(mark.ms>state.throughMs+LATE_MS)break;until=Math.max(until,mark.end)}
    if(!core.length||until<=from)return from;
    // The searched characters without punctuation, each with the transcript index just after it.
    const before=[];
    for(let i=from;i>0&&before.length<REPEAT_MAX;){const c=transcript[i-1];i--;if(!PUNCT.test(c))before.unshift({c,after:i+1})}
    const chars=[...before];
    for(let i=from;i<until;){const c=String.fromCodePoint(transcript.codePointAt(i));i+=c.length;if(!PUNCT.test(c))chars.push({c,after:i})}
    for(let n=Math.min(REPEAT_MAX,core.length);n>=Math.min(REPEAT_MIN,core.length);n--){
      const tail=core.slice(-n);
      for(let s=0;s+n<=chars.length;s++){   // the first occurrence that ends after the cut point
        if(chars[s+n-1].after<=from)continue;
        if(!tail.every((c,k)=>chars[s+k].c===c))continue;
        let i=chars[s+n-1].after;while(i<transcript.length&&PUNCT.test(transcript[i]))i++;   // past punctuation and spaces
        return i;
      }
    }
    return from;
  }
  // Two texts one after the other: directly when either side of the seam is Chinese/Japanese (or full-width
  // punctuation), with a space otherwise, so English sentences do not run together (as subtitles.js joinSentences).
  const CJK=/[　-〿぀-ヿ㐀-鿿＀-￯]/;
  function join(a,b){
    if(!a||!b)return a+b;
    const end=a.trimEnd().slice(-1),start=b.trimStart()[0]||'';
    return CJK.test(end)||CJK.test(start)?a.trimEnd()+b.trimStart():a.trimEnd()+' '+b.trimStart();
  }
  // Kept sentences joined into paragraphs (quality-transcript-flow): a pause of 3000 ms or more, or a paragraph
  // already 200 characters long, starts the next one. A sentence without times joins the current paragraph.
  const PAUSE_MS=3000,PARAGRAPH_CHARS=200;
  function paragraphs(records){
    const out=[];let prev=null;
    for(const s of records||[]){
      const timed=x=>x&&(x.startMs||x.endMs);
      const pause=timed(prev)&&timed(s)&&s.startMs-prev.endMs>=PAUSE_MS;
      if(!out.length||pause||[...out.at(-1)].length>=PARAGRAPH_CHARS)out.push(s.source);
      else out[out.length-1]=join(out.at(-1),s.source);
      if(timed(s))prev=s;   // a sentence without times does not hide a pause after the one before it
    }
    return out;
  }
  // live: {transcript, timeMarks, finals}. After the final event nothing live is left to show.
  function view(state,live){
    const finals=state.done?[]:(live.finals||[]).filter(s=>s.endMs>state.throughMs&&!state.taken.has(key(s)));
    const transcript=live.transcript||'';
    return {
      sources:state.records.map(s=>s.source),
      liveSource:state.done?'':transcript.slice(skipRepeat(state,transcript,live.timeMarks,liveFrom(state,live.timeMarks))),
      targets:state.records.map(s=>s.target),
      liveTargets:finals.map(s=>s.target),
      liveFinals:finals,
    };
  }
  function unavailable(state){return state.failures>=UNAVAILABLE_AFTER}
  root.QualityView={create,apply,revise,promote,view,liveFrom,paragraphs,join,unavailable};
  if(typeof module!=='undefined')module.exports=root.QualityView;
})(typeof globalThis!=='undefined'?globalThis:this);
