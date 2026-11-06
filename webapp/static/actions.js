// Action board: confirmed action items of the user's teams in status columns; filters live in the address.
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const FILTERS=['q','team','owner','due'];
const COLUMNS=['todo','doing','done','cancelled'];
let latest=0,peopleLoaded=false;

function notice(message){$('notice').textContent=message;$('notice').hidden=!message}
function dueLabel(item){
  if(!item.dueDate)return item.dueText?`到期：${item.dueText}`:'沒有到期日';
  const [y,m,d]=item.dueDate.split('-').map(Number);
  return `到期 ${y!==new Date().getFullYear()?`${y}/`:''}${m}/${d}${item.dueText?`（${item.dueText}）`:''}`;
}
function card(item){
  const meeting={title:item.meetingTitle,startedAt:item.startedAt};
  return el('article',{className:`card action-card status-${item.status}${item.overdueDays>0?' is-overdue':''}`,id:`action-${item.id}`},
    el('p',{className:'action-content',textContent:item.content}),
    el('div',{className:'action-meta'},
      el('span',{className:item.owner?'action-owner':'action-owner muted',textContent:item.owner?item.ownerName:'未指派'}),
      el('span',{className:'muted',textContent:dueLabel(item)})),
    ActionStatus.control(item,{meetingId:item.meetingId,onChange:(next,message)=>{notice(message);reload()},onError:notice}),
    el('a',{className:'action-source',href:`/meetings/${item.meetingId}/minutes#item-${item.id}`},
      el('span',{className:'count',textContent:item.team}),` ${MeetingCatalog.displayTitle(meeting)}`));
}
function currentFilters(){
  // Until the first answer fills the team and owner menus, their values come from the address.
  const value=k=>!peopleLoaded&&(k==='team'||k==='owner')?params.get(k)||'':$(k).value;
  const filters=Object.fromEntries(FILTERS.map(k=>[k,value(k)]).filter(([,v])=>v));
  if($('cancelled').checked)filters.cancelled='1';
  return filters;
}
async function load(){
  const ticket=++latest,filters=currentFilters(),query=new URLSearchParams(filters).toString();
  history.replaceState(null,'',query?`/actions?${query}`:'/actions');
  $('clear').hidden=!query;
  const api=new URLSearchParams({...filters,status:filters.cancelled?COLUMNS.join(','):COLUMNS.slice(0,3).join(',')});
  api.delete('cancelled');
  const response=await fetch(`/api/actions?${api}`);
  const data=await response.json().catch(()=>null);
  if(ticket!==latest)return;
  // A bookmarked team the user has left: show all their teams instead of staying on the error.
  if(response.status===404&&filters.team){params.delete('team');$('team').value='';await load();notice('找不到這個團隊，已改為顯示全部團隊');return}
  if(!response.ok||!data?.items)throw new Error(data?.detail||'無法載入待辦');
  if(!peopleLoaded){
    peopleLoaded=true;
    $('team').append(...data.teams.map(t=>el('option',{value:t.id,textContent:t.name})));
    $('owner').append(...data.people.map(p=>el('option',{value:p.username,textContent:p.displayName===p.username?p.username:`${p.displayName}（${p.username}）`})));
    $('team').value=params.get('team')||'';$('owner').value=params.get('owner')||'';
  }
  const overdue=data.items.filter(i=>i.overdueDays>0).length;
  $('summary').textContent=`${data.items.filter(i=>i.status==='todo'||i.status==='doing').length} 件未完成${overdue?`，${overdue} 件逾期`:''}`;
  const columns=COLUMNS.filter(s=>s!=='cancelled'||filters.cancelled);
  $('board').style.setProperty('--columns',columns.length);
  $('board').replaceChildren(...columns.map(status=>{
    const items=data.items.filter(i=>i.status===status);
    return el('section',{className:`board-column column-${status}`,ariaLabel:ActionStatus.LABEL[status]},
      el('h2',{className:'column-title'},ActionStatus.LABEL[status],el('span',{className:'count',textContent:String(items.length)})),
      ...(items.length?items.map(card):[el('p',{className:'muted small empty-column',textContent:query?'沒有符合條件的待辦':'沒有待辦'})]));
  }));
}
function reload(){load().catch(error=>notice(error.message))}

let params=new URLSearchParams(location.search);
for(const k of FILTERS)$(k).value=params.get(k)||'';
$('cancelled').checked=params.get('cancelled')==='1';
let typing;
$('q').oninput=()=>{clearTimeout(typing);typing=setTimeout(reload,300)};
for(const k of ['team','owner','due','cancelled'])$(k).onchange=()=>{notice('');reload()};
$('filters').onsubmit=event=>{event.preventDefault();reload()};
$('clear').onclick=()=>{params=new URLSearchParams();for(const k of FILTERS)$(k).value='';$('cancelled').checked=false;notice('');reload()};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
window.accountReady.then(reload);
