// Spec meeting-timeline: "Segments record their time span" examples (lead/tail measured by lagcheck.py).
const T=require('../webapp/static/timeline.js');
const t=(name,got,want)=>console.log(JSON.stringify(got)===JSON.stringify(want)?'ok  ':'FAIL',name,JSON.stringify(got));
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
