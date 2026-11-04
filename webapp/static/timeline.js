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
  root.MeetingTimeline={PLAY_LEAD_MS,PLAY_TAIL_MS,endMsAt,playWindow};
  if(typeof module!=='undefined')module.exports=root.MeetingTimeline;
})(typeof globalThis!=='undefined'?globalThis:this);
