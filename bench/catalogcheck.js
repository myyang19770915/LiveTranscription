// Spec meeting-catalog: default topic display and 今天／本週／更早 grouping (run with TZ=Asia/Taipei).
const C=require('../webapp/static/meeting-catalog.js');
const t=(name,got,want)=>console.log(JSON.stringify(got)===JSON.stringify(want)?'ok  ':'FAIL',name,JSON.stringify(got));
t('no topic shows start time',C.displayTitle({title:'',startedAt:'2026-11-04T23:37:00+08:00'}),'11/04 23:37 的會議');
t('topic shown as is',C.displayTitle({title:'週會',startedAt:'2026-11-04T23:37:00+08:00'}),'週會');
const now=new Date('2026-11-04T15:00:00+08:00');  // Wednesday
const at=(day,time='10:00')=>({startedAt:`2026-${day}T${time}:00+08:00`,title:day});
const groups=C.groupByDate([at('10-28'),at('11-04'),at('11-02')],now).map(g=>[g.label,g.items.map(m=>m.title)]);
t('three groups (spec)',groups,[['今天',['11-04']],['本週',['11-02']],['更早',['10-28']]]);
t('Monday is this week, Sunday is earlier',C.groupByDate([at('11-02','00:00'),at('11-01','23:59')],now).map(g=>[g.label,g.items.length]),[['本週',1],['更早',1]]);
t('empty groups left out',C.groupByDate([at('11-04')],now).map(g=>g.label),['今天']);
t('newest first inside a group',C.groupByDate([at('11-04','09:00'),at('11-04','11:00')],now)[0].items.map(m=>m.startedAt.slice(11,16)),['11:00','09:00']);
