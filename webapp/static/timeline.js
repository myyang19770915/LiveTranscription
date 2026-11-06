/* Where a finalized span sits in the meeting recording. Every recognition event carries audioMs, the
   gateway's audio clock when it was sent; text arrives after its audio, so a span's speech ends a little
   before the event that completed it. Playback therefore starts PLAY_LEAD_MS early. Measured with
   bench/lagcheck.py (2026-11-04): text trails speech by a median 0.5–3.8 s for Chinese and Japanese on
   either engine. */
(function(root){
  const PLAY_LEAD_MS=3000,PLAY_TAIL_MS=500;
  // marks: [{end: transcript length after an event, ms: its audioMs}] in arrival order.
  function endMsAt(marks,offset,fallback=0){
    const mark=marks.find(m=>m.end>=offset);
    return mark?mark.ms:(marks.length?marks[marks.length-1].ms:fallback);
  }
  function playWindow(startMs,endMs,totalMs=Infinity){
    return {start:Math.max(0,startMs-PLAY_LEAD_MS),end:Math.min(totalMs,endMs+PLAY_TAIL_MS)};
  }
  // Minutes evidence panel: the cited segments with one neighbour each side, in timeline order.
  // Returns [{segment, cited, gapBefore}]; gapBefore marks a jump over segments that are not shown.
  function evidenceContext(segments,citedSeqs){
    const cited=new Set(citedSeqs),shown=new Set();
    segments.forEach((s,i)=>{if(cited.has(s.seq))for(const j of [i-1,i,i+1])if(segments[j])shown.add(j)});
    let last=-1;
    return [...shown].sort((a,b)=>a-b).map(i=>{const row={segment:segments[i],cited:cited.has(segments[i].seq),gapBefore:last>=0&&i>last+1};last=i;return row});
  }
  root.MeetingTimeline={PLAY_LEAD_MS,PLAY_TAIL_MS,endMsAt,playWindow,evidenceContext};
  if(typeof module!=='undefined')module.exports=root.MeetingTimeline;
})(typeof globalThis!=='undefined'?globalThis:this);
