// Spec meeting-timeline: "Segments record their time span" examples (lead/tail measured by lagcheck.py).
const T=require('../webapp/static/timeline.js');
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
// Consecutive segments: segment 1 ends at the event with audioMs 4200, segment 2 at 9100.
const marks=[{end:5,ms:1800},{end:12,ms:4200},{end:20,ms:7000},{end:31,ms:9100}];
const end1=T.endMsAt(marks,12),end2=T.endMsAt(marks,31);
t('segment 1 spans 0-4200',[0,end1],[0,4200]);
t('segment 2 spans 4200-9100',[end1,end2],[4200,9100]);
t('span end between marks takes the next event',T.endMsAt(marks,13),7000);
t('no marks falls back',T.endMsAt([],10,1234),1234);
for(const [start,end,total,want] of [[0,4200,60000,{start:0,end:4700}],[4200,9100,60000,{start:1200,end:9600}],[58000,59800,60000,{start:55000,end:60000}]])
  t(`playback ${start}-${end}`,T.playWindow(start,end,total),want);
// Review page "往前 2 秒": the segment's start moves 2000 ms earlier before padding.
t('extend start once: 0-9600',T.playWindow(4200-2000,9100,60000),{start:0,end:9600});
// segment-audio-times: a timed segment plays from 0.3 s before its start to 0.3 s after its end, inside the recording.
t('timed 4200-9100: 3900-9400',T.playWindow(4200,9100,60000,true),{start:3900,end:9400});
t('timed, at the edges of the recording',T.playWindow(100,59900,60000,true),{start:0,end:60000});
// Spec meeting-minutes "Viewing evidence in place", example "segments shown" (15 segments).
const meeting15=Array.from({length:15},(_,i)=>({seq:i+1}));
const shown=cited=>T.evidenceContext(meeting15,cited).map(r=>`${r.gapBefore?'| ':''}${r.segment.seq}${r.cited?'*':''}`).join(' ');
t('cited 4, 5 shows 3-6, no gap',shown([4,5]),'3 4* 5* 6');
t('cited 1, 9 shows 1, 2 | 8, 9, 10',shown([1,9]),'1* 2 | 8 9* 10');
t('cited 15 shows 14, 15',shown([15]),'14 15*');
t('cited seq not in the meeting shows nothing',shown([99]),'');
