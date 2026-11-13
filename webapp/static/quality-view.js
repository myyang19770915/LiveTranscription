/* 精準模式 on the live page (quality-pass). The gateway sends corrected sentences for a time range; they are
   kept, and live text and live finalized translations of that range stop being shown. A failed range keeps
   its live finalized segments instead. Kept segments only ever grow at the end, so their saved order is stable. */
(function(root){
  const UNAVAILABLE_AFTER=3;
  const LATE_MS=1500;   // live text reaches the page up to ~1.3 s after its audio, so its segment can end that much past a range
  function create(){return {records:[],throughMs:0,failures:0,done:false,gaps:[],taken:new Set()}}
  const key=s=>s.id||`${s.startMs}:${s.endMs}:${s.source}`;
  // Live finalized segments of a failed range become kept segments, also the ones finalized after the failure was
  // reported. Kept at the end of the list, so earlier positions never change.
  function promote(state,liveFinals){
    for(const s of liveFinals||[]){
      if(state.taken.has(key(s))||!state.gaps.some(gap=>s.endMs>gap.from&&s.endMs<=gap.to+LATE_MS))continue;
      state.taken.add(key(s));
      state.records.push({source:s.source,target:s.target,detected:s.detected||'',startMs:s.startMs||0,endMs:s.endMs||0,live:true});
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
        state.records.push({source:s.source,target:s.target,detected:s.lang||'',startMs:Number(s.startMs)||0,endMs:Number(s.endMs)||0});
      }
      state.throughMs=Math.max(state.throughMs,state.records.at(-1)?.endMs||0);
      state.failures=0;
    }
    if(event.final)state.done=true;
    return state;
  }
  // Where the live transcript is still shown from: the end of the last text that arrived by throughMs.
  function liveFrom(state,timeMarks){
    let at=0;
    for(const mark of timeMarks||[]){if(mark.ms>state.throughMs)break;at=mark.end}
    return at;
  }
  // live: {transcript, timeMarks, finals}. After the final event nothing live is left to show.
  function view(state,live){
    const finals=state.done?[]:(live.finals||[]).filter(s=>s.endMs>state.throughMs&&!state.taken.has(key(s)));
    return {
      sources:state.records.map(s=>s.source),
      liveSource:state.done?'':(live.transcript||'').slice(liveFrom(state,live.timeMarks)),
      targets:state.records.map(s=>s.target),
      liveTargets:finals.map(s=>s.target),
      liveFinals:finals,
    };
  }
  function unavailable(state){return state.failures>=UNAVAILABLE_AFTER}
  root.QualityView={create,apply,promote,view,liveFrom,unavailable};
  if(typeof module!=='undefined')module.exports=root.QualityView;
})(typeof globalThis!=='undefined'?globalThis:this);
