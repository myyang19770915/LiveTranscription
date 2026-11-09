// Action board in the spirit of a Jira board (jira-style-board): compact cards, drag between columns to change
// the status, a detail panel to edit, quick filters, avatar filter and swimlanes. Everything filterable lives in
// the address; the open card too (?item=). ＋ 新增待辦 (or c) creates an item that belongs to no meeting
// (board-created-actions); every item is changed through /api/actions/{id}.
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const COLUMNS=['todo','doing','done','cancelled'];
const AVATAR_MAX=12;
const CALENDAR='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
let params=new URLSearchParams(location.search);
let data=null,latest=0,teamsLoaded=false,allDone=false,dragging=null,shownVersion=null;

function notice(message){$('notice').textContent=message||'';$('notice').hidden=!message}
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}}};
function setParam(key,value){if(value)params.set(key,value);else params.delete(key);history.replaceState(null,'',params.toString()?`/actions?${params}`:'/actions')}

// --- Pieces ---
// A person's photo (member-avatars) when they have one in people, otherwise, or if it fails to load, the initial.
function avatarFor(username,name,size=''){
  if(!username)return el('span',{className:`avatar-mini empty ${size}`,title:'未指派',ariaLabel:'未指派'});
  const {initial,color}=ActionBoard.avatar(username,name);
  const letter=()=>el('span',{className:`avatar-mini c${color} ${size}`,title:name||username,textContent:initial});
  const url=data?.people.find(p=>p.username===username)?.avatarUrl;
  if(!url)return letter();
  const img=el('img',{className:`avatar-mini photo ${size}`,src:url,alt:name||username,title:name||username,draggable:false});
  img.onerror=()=>img.replaceWith(letter());
  return img;
}
function dueChip(item){
  const tone=ActionBoard.dueTone(item,today());
  if(tone==='overdue')return el('span',{className:'due-chip overdue',textContent:`逾期 ${item.overdueDays} 天`});
  if(!item.dueDate)return null;
  const [,m,d]=item.dueDate.split('-').map(Number);
  return el('span',{className:`due-chip ${tone}`,title:item.dueText?`原話：${item.dueText}`:''},el('span',{className:'due-icon',innerHTML:CALENDAR}),`${m}/${d}`);
}
const actionUrl=id=>`/api/actions/${id}`;
let me=null;   // the signed-in user (/api/me): who may switch an item's reminders
const MUTED='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 9 3 9H9M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18M6 8c0 7-3 9-3 9h3"/></svg>';
const meetingName=item=>item.meetingId?`${item.team} · ${MeetingCatalog.displayTitle({title:item.meetingTitle,startedAt:item.startedAt})}`
  :`${item.team} · ${ActionBoard.BOARD_SOURCE}${item.series?` · ${item.series}`:''}`;
function laneName(item){
  const d=new Date(item.startedAt);
  return `${meetingName(item)}${item.meetingTitle?`（${d.getMonth()+1}/${d.getDate()}）`:''}${item.series?` · ${item.series}`:''}`;
}
// The server's today (MEETING_TIMEZONE), at noon so a local-time conversion cannot move it to another day.
const today=()=>{const [y,m,d]=(data?.today||'').split('-').map(Number);return y?new Date(y,m-1,d,12):new Date()};
function card(item){
  const node=el('article',{className:`issue status-${item.status}${item.overdueDays>0?' is-overdue':''}`,id:`action-${item.id}`,tabIndex:0,draggable:true,
      ariaLabel:`#${item.id} ${item.content}`},
    el('p',{className:'issue-source',textContent:meetingName(item)}),
    el('p',{className:'issue-summary',textContent:item.content}),
    el('div',{className:'issue-foot'},
      el('span',{className:'issue-key',textContent:`#${item.id}`}),dueChip(item),
      item.remind?null:el('span',{className:'issue-muted',title:'已關閉 Email 提醒',ariaLabel:'已關閉 Email 提醒',innerHTML:MUTED}),
      el('span',{className:'issue-gap'}),
      avatarFor(item.owner,item.ownerName)));
  node.onclick=()=>openDetail(item.id);
  node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetail(item.id)}};
  node.ondragstart=event=>{dragging=item;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(item.id));node.classList.add('dragging')};
  node.ondragend=()=>{dragging=null;node.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(c=>c.classList.remove('drop-target'))};
  return node;
}
function column(status,items){
  let shown=items,earlier=[];
  if(status==='done'&&!allDone)({shown,earlier}=ActionBoard.recentDone(items,today()));
  const body=el('div',{className:'column-body'},...shown.map(card),
    earlier.length?el('button',{type:'button',className:'more-done',textContent:`另有 ${earlier.length} 件較早完成`,onclick:()=>{allDone=true;render()}}):null,
    !items.length?el('p',{className:'column-empty',textContent:'沒有待辦'}):null);
  const col=el('section',{className:`board-column column-${status}`,ariaLabel:ActionStatus.LABEL[status]},
    el('h2',{className:'column-title'},el('span',{textContent:ActionStatus.LABEL[status]}),el('span',{className:'column-count',textContent:String(items.length)})),body);
  col.ondragover=event=>{if(!dragging)return;event.preventDefault();col.classList.add('drop-target')};
  col.ondragleave=event=>{if(!col.contains(event.relatedTarget))col.classList.remove('drop-target')};
  col.ondrop=event=>{event.preventDefault();col.classList.remove('drop-target');const item=dragging;dragging=null;if(item)moveTo(item,status)};
  return col;
}
async function moveTo(item,status){
  if(item.status===status)return;
  if(status==='cancelled'){openDetail(item.id,{cancel:true});return}     // a reason is required first
  try{const {message}=await ActionStatus.send(actionUrl(item.id),item,status,'');notice(message)}
  catch(error){notice(error.message)}
  await reload();
}

// --- Board ---
function render(){
  const columns=COLUMNS.filter(s=>s!=='cancelled'||params.get('cancelled'));
  const group=params.get('group')||'';
  const lanes=ActionBoard.swimlanes(data.items,group,laneName);
  $('board').style.setProperty('--columns',columns.length);
  $('board').classList.toggle('grouped',!!group);
  $('board').replaceChildren(...lanes.map(lane=>{
    const grid=el('div',{className:'lane-columns'},...columns.map(s=>column(s,lane.items.filter(i=>i.status===s))));
    if(!group)return grid;
    const key=`lane:${group}:${lane.key}`,collapsed=store.get(key)==='1';
    const toggle=el('button',{type:'button',className:'lane-toggle',ariaExpanded:String(!collapsed)},
      el('span',{className:'lane-caret',textContent:'▾'}),
      group==='owner'?avatarFor(lane.key,lane.label):null,
      el('b',{textContent:lane.label}),el('span',{className:'column-count',textContent:`${lane.items.length} 件`}));
    toggle.onclick=()=>{store.set(key,collapsed?null:'1');render()};
    return el('section',{className:`lane${collapsed?' collapsed':''}`},toggle,collapsed?null:grid);
  }));
  if(!$('detail').hidden)$(`action-${params.get('item')}`)?.classList.add('selected');
  renderFilters();
}
function pressQuick(){for(const button of document.querySelectorAll('.quick'))button.setAttribute('aria-pressed',String(params.get(button.dataset.key)===button.dataset.value))}
function moreAvatars(owner){
  const rest=data.people.slice(AVATAR_MAX);
  const menu=el('select',{className:'avatar-more',ariaLabel:'其他成員'},el('option',{value:'',textContent:`+${rest.length}`}),
    ...rest.map(p=>el('option',{value:p.username,textContent:p.displayName})));
  menu.value=rest.some(p=>p.username===owner)?owner:'';
  menu.onchange=()=>{setParam('owner',menu.value);reload()};
  return menu;
}
function renderFilters(){
  pressQuick();
  const owner=params.get('owner');
  $('avatars').replaceChildren(...data.people.slice(0,AVATAR_MAX).map(p=>{
    const button=el('button',{type:'button',className:'avatar-button',title:p.displayName},avatarFor(p.username,p.displayName,'large'));
    button.setAttribute('aria-pressed',String(owner===p.username));button.setAttribute('aria-label',`只看 ${p.displayName}`);
    button.onclick=()=>{setParam('owner',owner===p.username?'':p.username);reload()};
    return button;
  }),...(data.people.length>AVATAR_MAX?[moreAvatars(owner)]:[]));
  $('clear').hidden=!['q','team','owner','due','cancelled'].some(k=>params.get(k));
  const open=data.items.filter(i=>i.status==='todo'||i.status==='doing'),overdue=open.filter(i=>i.overdueDays>0).length;
  $('summary').textContent=`${open.length} 件未完成${overdue?`，${overdue} 件逾期`:''}`;
}
async function load(){
  const ticket=++latest;
  const query=new URLSearchParams();
  for(const k of ['q','team','owner','due'])if(params.get(k))query.set(k,params.get(k));
  query.set('status',(params.get('cancelled')?COLUMNS:COLUMNS.slice(0,3)).join(','));
  const response=await fetch(`/api/actions?${query}`);
  const result=await response.json().catch(()=>null);
  if(ticket!==latest)return;
  // A bookmarked team the user has left: show all their teams instead of staying on the error.
  if(response.status===404&&params.get('team')){setParam('team','');$('team').value='';await load();notice('找不到這個團隊，已改為顯示全部團隊');return}
  if(!response.ok||!result?.items)throw new Error(result?.detail||'無法載入待辦');
  data=result;
  if(!teamsLoaded){
    teamsLoaded=true;
    $('team').append(...data.teams.map(t=>el('option',{value:t.id,textContent:t.name})));
    $('team').value=params.get('team')||'';
  }
  render();
  // The open card (?item=) follows the latest data; it closes when the filters no longer include it.
  const open=Number(params.get('item')),current=data.items.find(i=>i.id===open);
  if(open&&current&&!$('detail').hidden&&current.version===shownVersion)$(`action-${open}`)?.classList.add('selected');
  else if(open)openDetail(open,{keep:true});
}
function reload(){return load().catch(error=>notice(error.message))}
// The header menu changed the user's own photo (avatar-self-service): show it on the board.
window.addEventListener('yq:avatar',()=>reload());

// --- Detail panel ---
// A refused edit keeps what was being typed: the panel is redrawn on reload, and reopens the editor with it.
let unsaved=null;   // {id, content}
async function patchItem(item,body){
  const response=await fetch(actionUrl(item.id),{method:'PATCH',headers:{'content-type':'application/json'},
    body:JSON.stringify({version:item.version,...body})});
  const result=await response.json().catch(()=>({}));
  const message=response.ok?'':typeof result.detail==='string'?result.detail:'儲存失敗';
  if(response.ok)fresh(item,result);
  else if('content' in body)unsaved={id:item.id,content:body.content};
  await reload();
  panelError(message);   // after the reload, which may have redrawn the panel
  return response.ok;
}
// The server's answer carries the new version: take it at once, so a second edit before the board reloads is not stale.
function fresh(item,next){
  const {version,status,statusNote,owner,ownerName,dueDate,dueText,overdueDays,content,remind}=next;
  Object.assign(item,{version,status,statusNote,owner,ownerName,dueDate,dueText,overdueDays,remind},content?{content}:{});
}
function panelError(message){const box=$('detailError');if(box){box.textContent=message||'';box.hidden=!message}}
function showPanel(key){
  document.documentElement.style.setProperty('--detail-top',`${document.querySelector('.topbar').offsetHeight}px`);
  document.body.classList.add('detail-open');$('detail').hidden=false;
  $('detailKey').textContent=key;
}
const field=(label,...content)=>el('div',{className:'detail-field'},el('span',{className:'detail-label',textContent:label}),el('div',{className:'detail-value'},...content));
function ownerOptions(teamId,current){
  const members=data.people.filter(p=>p.teams.includes(teamId));
  return [el('option',{value:'',textContent:'未指派'}),
    ...members.map(p=>el('option',{value:p.username,textContent:p.displayName===p.username?p.username:`${p.displayName}（${p.username}）`,selected:p.username===current}))];
}
// The title, and 編輯 to change it in place (Enter saves, Esc puts it back).
function titleOf(item){
  const title=el('h2',{id:'detailTitle',className:'detail-title',textContent:item.content});
  const edit=el('button',{type:'button',className:'text-button',textContent:'編輯'});
  const head=el('div',{className:'detail-title-row'},title,edit);
  edit.onclick=()=>{
    const draft=unsaved?.id===item.id?unsaved.content:item.content;unsaved=null;
    const box=el('textarea',{className:'input detail-edit',value:draft,maxLength:500,rows:3,ariaLabel:'待辦內容'});
    const save=el('button',{type:'submit',className:'primary-button compact',textContent:'儲存'});
    const back=()=>form.replaceWith(head);
    const form=el('form',{className:'detail-edit-form'},box,el('div',{className:'detail-edit-actions'},save,
      el('button',{type:'button',className:'text-button',textContent:'取消',onclick:back})));
    form.onsubmit=async event=>{event.preventDefault();
      if(!box.value.trim()){box.focus();return}
      save.disabled=true;
      if(!await patchItem(item,{content:box.value}))save.disabled=false;
    };
    box.onkeydown=event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit()}
      if(event.key==='Escape'){event.stopPropagation();back()}
    };
    head.replaceWith(form);box.focus();box.select();
  };
  if(unsaved?.id===item.id)queueMicrotask(()=>edit.isConnected&&edit.click());
  return head;
}
// Delete, for an item created on the board only: a second press confirms.
function deleteButton(item){
  const button=el('button',{type:'button',className:'text-button danger',textContent:'刪除待辦'});
  button.onclick=async()=>{
    if(!button.dataset.confirm){button.dataset.confirm='1';button.textContent='確定刪除？無法復原';
      setTimeout(()=>{if(button.isConnected){delete button.dataset.confirm;button.textContent='刪除待辦'}},4000);return}
    button.disabled=true;
    const response=await fetch(actionUrl(item.id),{method:'DELETE'});
    if(!response.ok){const result=await response.json().catch(()=>({}));panelError(typeof result.detail==='string'?result.detail:'刪除失敗');button.disabled=false;return}
    closeDetail();notice(`已刪除 #${item.id}`);await reload();
  };
  return button;
}
// Due-date e-mail reminders (action-reminders): the owner or an administrator switches them; others see the state.
function reminderField(item){
  const open=['todo','doing'].includes(item.status);
  const allowed=me?.admin||me?.username===item.owner;
  const hint=!item.remind?'不會寄出這件事的提醒':!item.owner||!item.dueDate?'需要負責人與到期日才會提醒':!open?'已完成或取消，不再提醒'
    :'到期前 3 天、到期當天、逾期每天寄給負責人';
  const state=el('span',{className:`remind-state${item.remind?'':' off'}`,textContent:item.remind?'開啟':'已關閉'});
  const note=el('p',{className:'field-hint',textContent:allowed?hint:`${hint}（只有負責人或系統管理員可切換）`});
  if(!allowed)return [el('div',{className:'remind-row'},state),note];
  const button=el('button',{type:'button',className:'remind-switch',title:item.remind?'關閉提醒':'開啟提醒',ariaLabel:'Email 提醒'});
  button.setAttribute('role','switch');button.setAttribute('aria-checked',String(item.remind));
  button.onclick=async()=>{
    button.disabled=true;
    const response=await fetch(`${actionUrl(item.id)}/remind`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on:!item.remind})});
    const result=await response.json().catch(()=>({}));
    if(response.ok)fresh(item,result);
    await reload();
    // The switch does not change the item's version, so the reload keeps the panel as it was: redraw it.
    if(!$('detail').hidden&&Number(params.get('item'))===item.id)openDetail(item.id,{keep:true});
    panelError(response.ok?'':typeof result.detail==='string'?result.detail:'切換失敗');
  };
  return [el('div',{className:'remind-row'},button,state),note];
}
function openDetail(id,{cancel=false,keep=false}={}){
  const item=data.items.find(i=>i.id===id);
  if(!item){closeDetail();return}
  if(!keep)setParam('item',String(id));
  document.querySelectorAll('.issue.selected').forEach(n=>n.classList.remove('selected'));
  $(`action-${id}`)?.classList.add('selected');
  showPanel(`#${item.id}`);
  shownVersion=item.version;
  const status=ActionStatus.control(item,{url:actionUrl(item.id),onChange:(next,message)=>{fresh(item,next);panelError(message);reload()},onError:panelError});
  const members=data.people.filter(p=>p.teams.includes(item.teamId));
  const owner=el('select',{className:'input compact',ariaLabel:'負責人'},...ownerOptions(item.teamId));
  if(item.owner&&!members.some(p=>p.username===item.owner))owner.append(el('option',{value:item.owner,disabled:true,textContent:`${item.ownerName||item.owner}（已不在團隊）`}));
  owner.value=item.owner||'';owner.onchange=()=>patchItem(item,{owner:owner.value||null});
  const due=el('input',{className:'input compact',type:'date',value:item.dueDate||'',ariaLabel:'到期日'});
  due.onchange=()=>patchItem(item,{dueDate:due.value||null});
  $('detailBody').replaceChildren(
    titleOf(item),
    el('p',{id:'detailError',className:'alert',role:'alert',hidden:true}),
    field('狀態',status),
    field('負責人',owner,avatarFor(item.owner,item.ownerName)),
    field('到期日',due,dueChip(item),item.dueText?el('p',{className:'field-hint',textContent:`原話：「${item.dueText}」`}):null),
    field('Email 提醒',...reminderField(item)),
    field('團隊',el('span',{textContent:item.team})),
    field('來源',item.meetingId?el('a',{href:`/meetings/${item.meetingId}/minutes#item-${item.id}`,textContent:meetingName(item)})
      :el('span',{textContent:`${ActionBoard.BOARD_SOURCE}${item.series?`，系列「${item.series}」的會議會帶出`:''}`})),
    el('p',{className:'detail-hint muted small',textContent:'按「歷程」看每次狀態變更；會議中套用的進度提示會附上那場會議的連結。'}),
    item.meetingId?'':el('div',{className:'detail-danger'},deleteButton(item)));   // replaceChildren would print null
  // Opened by dropping on 已取消: ask for the reason right away.
  if(cancel){const select=status.querySelector('select');select.value='cancelled';select.dispatchEvent(new Event('change'))}
}
// --- New item (board-created-actions) ---
async function openCreate(){
  if(!data)return;
  setParam('item','');
  document.querySelectorAll('.issue.selected').forEach(n=>n.classList.remove('selected'));
  showPanel('新增待辦');shownVersion=null;
  const content=el('textarea',{className:'input detail-edit',maxLength:500,rows:3,required:true,placeholder:'要做什麼？例如：週五前把報價單寄給客戶',ariaLabel:'待辦內容'});
  const team=el('select',{className:'input compact',ariaLabel:'團隊'},...data.teams.map(t=>el('option',{value:t.id,textContent:t.name})));
  team.value=params.get('team')&&data.teams.some(t=>String(t.id)===params.get('team'))?params.get('team'):String(data.teams[0]?.id??'');
  const owner=el('select',{className:'input compact',ariaLabel:'負責人'});
  const due=el('input',{className:'input compact',type:'date',ariaLabel:'到期日'});
  const series=el('select',{className:'input compact',ariaLabel:'系列'});
  const create=el('button',{type:'submit',className:'primary-button compact',textContent:'建立'});
  async function teamChanged(){
    const id=Number(team.value);
    owner.replaceChildren(...ownerOptions(id));
    series.replaceChildren(el('option',{value:'',textContent:'不屬於系列'}));
    const list=await fetch(`/api/teams/${id}/series`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    if(String(id)===team.value)series.append(...list.map(s=>el('option',{value:s.id,textContent:s.name})));
  }
  team.onchange=teamChanged;
  const form=el('form',{className:'detail-create'},
    el('h2',{id:'detailTitle',className:'detail-title',textContent:'新增待辦'}),
    el('p',{id:'detailError',className:'alert',role:'alert',hidden:true}),
    content,field('團隊',team),field('負責人',owner),field('到期日',due),
    field('系列',series,el('span',{className:'muted small',textContent:'選了系列，下次這個系列開會時會帶出來追蹤'})),
    el('div',{className:'detail-edit-actions'},create,el('button',{type:'button',className:'text-button',textContent:'取消',onclick:closeDetail})));
  form.onsubmit=async event=>{event.preventDefault();
    if(!content.value.trim()){content.focus();return}
    create.disabled=true;panelError('');
    const response=await fetch('/api/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      teamId:Number(team.value),content:content.value,owner:owner.value||null,dueDate:due.value||null,seriesId:series.value?Number(series.value):null})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){panelError(typeof result.detail==='string'?result.detail:'建立失敗');create.disabled=false;return}
    setParam('item',String(result.id));
    await reload();
    if(!data.items.some(i=>i.id===result.id)){closeDetail();notice(`已建立 #${result.id}，但不符合目前的篩選條件`)}
  };
  content.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();form.requestSubmit()}};
  $('detailBody').replaceChildren(form);
  await teamChanged();
  content.focus();
}
function closeDetail(){
  $('detail').hidden=true;document.body.classList.remove('detail-open');setParam('item','');
  document.querySelectorAll('.issue.selected').forEach(n=>n.classList.remove('selected'));
}

// --- Filters ---
for(const k of ['q','team','group'])$(k).value=params.get(k)||'';
let typing;
$('q').oninput=()=>{clearTimeout(typing);typing=setTimeout(()=>{setParam('q',$('q').value.trim());reload()},300)};
$('team').onchange=()=>{notice('');setParam('team',$('team').value);reload()};
$('group').onchange=()=>{setParam('group',$('group').value);render()};
for(const button of document.querySelectorAll('.quick'))button.onclick=()=>{
  const {key,value}=button.dataset;setParam(key,params.get(key)===value?'':value);pressQuick();notice('');reload();
};
$('filters').onsubmit=event=>{event.preventDefault();setParam('q',$('q').value.trim());reload()};
$('clear').onclick=()=>{for(const k of ['q','team','owner','due','cancelled'])params.delete(k);$('q').value='';$('team').value='';setParam('q','');notice('');reload()};
$('detailClose').onclick=closeDetail;
$('create').onclick=openCreate;
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('detail').hidden)closeDetail();
  // c: new item, as on a Jira board, unless typing or a dialog is open.
  const typing=event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if(event.key==='c'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!typing&&!document.querySelector('dialog[open]')){event.preventDefault();openCreate()}
});
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
window.accountReady.then(account=>{me=account;return reload()});
