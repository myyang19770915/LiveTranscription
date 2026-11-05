/* How meetings are named and grouped on the meeting list and the review page (local time). */
(function(root){
  const pad=n=>String(n).padStart(2,'0');
  // A meeting without a topic is shown by its start time.
  function displayTitle(meeting){
    if(meeting.title)return meeting.title;
    const d=new Date(meeting.startedAt);
    return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 的會議`;
  }
  function dayStart(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
  // 今天, 本週 (weeks start on Monday) and 更早, newest first; empty groups are left out.
  function groupByDate(meetings,now=new Date()){
    const today=dayStart(now),monday=new Date(today);monday.setDate(today.getDate()-((today.getDay()+6)%7));
    const groups=[{label:'今天',items:[]},{label:'本週',items:[]},{label:'更早',items:[]}];
    for(const m of [...meetings].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))){
      const d=new Date(m.startedAt);
      groups[d>=today?0:d>=monday?1:2].items.push(m);
    }
    return groups.filter(g=>g.items.length);
  }
  root.MeetingCatalog={displayTitle,groupByDate};
  if(typeof module!=='undefined')module.exports=root.MeetingCatalog;
})(typeof globalThis!=='undefined'?globalThis:this);
