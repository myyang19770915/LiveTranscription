/* Action board rules that need no page (jira-style-board): which done items show by default, swimlanes,
   the due tone of a card and the avatar of a person. Shared by actions.js and bench/boardcheck.js. */
(function(root){
  const RECENT_DAYS=14,SOON_DAYS=2,COLORS=6;
  const dayStart=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const daysBetween=(a,b)=>Math.round((dayStart(b)-dayStart(a))/86400000);

  // Done items whose last status change is within RECENT_DAYS of today (local dates); the rest are "earlier".
  function recentDone(items,now=new Date()){
    const shown=[],earlier=[];
    for(const item of items)(item.statusAt&&daysBetween(new Date(item.statusAt),now)<=RECENT_DAYS?shown:earlier).push(item);
    return {shown,earlier};
  }
  // 'overdue', 'soon' (due today or within SOON_DAYS), or '' — finished items have no tone.
  function dueTone(item,now=new Date()){
    if(item.overdueDays>0)return 'overdue';
    if(!item.dueDate||item.status==='done'||item.status==='cancelled')return '';
    const [y,m,d]=item.dueDate.split('-').map(Number);
    const left=daysBetween(now,new Date(y,m-1,d));
    return left>=0&&left<=SOON_DAYS?'soon':'';
  }
  function avatar(username,displayName){
    let hash=0;for(const ch of username||'')hash=(hash*31+ch.codePointAt(0))>>>0;
    return {initial:[...(displayName||username||'?')][0].toUpperCase(),color:hash%COLORS};
  }
  // [{key, label, items}] by owner or by source meeting; named lanes sorted, 未指派 / 沒有來源 last. group '' = one lane.
  function swimlanes(items,group,meetingLabel=i=>i.meetingTitle){
    if(group!=='owner'&&group!=='meeting')return [{key:'',label:'',items}];
    const lanes=new Map();
    for(const item of items){
      const key=group==='owner'?item.owner||'':item.meetingId;
      const label=group==='owner'?(item.owner?item.ownerName:'未指派'):meetingLabel(item);
      if(!lanes.has(key))lanes.set(key,{key,label,items:[],last:group==='owner'&&!item.owner});
      lanes.get(key).items.push(item);
    }
    return [...lanes.values()].sort((a,b)=>a.last-b.last||a.label.localeCompare(b.label,'zh-Hant')).map(({key,label,items})=>({key,label,items}));
  }
  root.ActionBoard={RECENT_DAYS,recentDone,dueTone,avatar,swimlanes};
  if(typeof module!=='undefined')module.exports=root.ActionBoard;
})(typeof globalThis!=='undefined'?globalThis:this);
