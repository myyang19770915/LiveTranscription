// Spec action-tracking "Action board": done column example and the board's card/lane rules (board.js).
const B=require('../webapp/static/board.js');
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,JSON.stringify(got));if(!ok)process.exitCode=1};
// Example "done column on 2026-11-20".
const now=new Date(2026,10,20,10,0);
const done=[{id:'F',statusAt:'2026-11-18T09:00:00+08:00'},{id:'G',statusAt:'2026-11-06T09:00:00+08:00'},
  {id:'H',statusAt:'2026-11-05T09:00:00+08:00'},{id:'I',statusAt:null}];
const {shown,earlier}=B.recentDone(done,now);
t('recent done shown',shown.map(i=>i.id),['F','G']);
t('earlier done',earlier.map(i=>i.id),['H','I']);
// Due tone on 2026-11-20.
for(const [item,want] of [[{overdueDays:2,dueDate:'2026-11-18',status:'todo'},'overdue'],[{overdueDays:0,dueDate:'2026-11-20',status:'todo'},'soon'],
  [{overdueDays:0,dueDate:'2026-11-22',status:'doing'},'soon'],[{overdueDays:0,dueDate:'2026-11-23',status:'todo'},''],
  [{overdueDays:0,dueDate:'2026-11-21',status:'done'},''],[{overdueDays:0,dueDate:null,status:'todo'},'']])
  t(`due tone ${item.dueDate} ${item.status}`,B.dueTone(item,now),want);
t('avatar initial from display name',B.avatar('alice','王愛麗').initial,'王');
t('avatar initial from username',B.avatar('bob','').initial,'B');
t('avatar color is stable',B.avatar('alice','x').color,B.avatar('alice','y').color);
// Swimlanes by owner: named lanes sorted, 未指派 last.
const items=[{id:1,owner:'bob',ownerName:'bob',meetingId:'m1',meetingTitle:'週會'},{id:2,owner:null,ownerName:null,meetingId:'m2',meetingTitle:'專案會'},
  {id:3,owner:'alice',ownerName:'alice',meetingId:'m1',meetingTitle:'週會'}];
t('lanes by owner',B.swimlanes(items,'owner').map(l=>[l.label,l.items.map(i=>i.id)]),[['alice',[3]],['bob',[1]],['未指派',[2]]]);
t('lanes by meeting',B.swimlanes(items,'meeting').map(l=>[l.label,l.items.length]),[['專案會',1],['週會',2]]);
t('no grouping is one lane',B.swimlanes(items,'').length,1);
// board-created-actions: items with no meeting form the 看板新增 lane, after the meetings (even if it sorts first).
const withBoard=[...items,{id:4,owner:'bob',ownerName:'bob',meetingId:null,meetingTitle:null}];
t('board items lane last',B.swimlanes(withBoard,'meeting',i=>`A ${i.meetingTitle}`).map(l=>[l.label,l.items.map(i=>i.id)]),
  [['A 專案會',[2]],['A 週會',[1,3]],['看板新增',[4]]]);
