// Meeting minutes: generate with the minutes model, then confirm, correct or reject each item.
const $=id=>document.getElementById(id);
const meetingId=location.pathname.split('/').filter(Boolean).at(-2);
const KINDS=[['decision','決議'],['action','待辦'],['question','待確認問題'],['risk','風險']];
const STATE={proposed:'待確認',confirmed:'已確認',rejected:'已駁回'};
let data=null,editing=null,adding=null,summaryEditing=false,poll=null;
let meeting=null,peeking=null,audioUrl=null,linkedShown=false;   // meeting: /api/meetings/<id> (header and evidence segments)
const linkedId=Number(location.hash.match(/^#item-(\d+)$/)?.[1]);   // from the board (#item-N): that item stays marked

function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const pad=n=>String(n).padStart(2,'0');
const clock=MeetingNav.clock;
function notice(message){$('notice').textContent=message;$('notice').hidden=!message}
async function call(method,url,body){
  const response=await fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({}));
  if(response.status===409&&result.item){replaceItem(result.item);notice(result.detail);throw Object.assign(new Error(result.detail),{stale:true})}
  // Someone regenerated meanwhile and the item is gone: show the minutes as they are now.
  if(response.status===404&&/\/items\//.test(url)){notice('這個條目已被重新產生的結果取代，已重新載入');await load();throw Object.assign(new Error(''),{stale:true})}
  if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'操作失敗');
  return result;
}
function replaceItem(item){const i=data.items.findIndex(x=>x.id===item.id);if(i>=0)data.items[i]=item;else data.items.push(item);render()}
async function act(work){notice('');try{await work()}catch(error){if(!error.stale)notice(error.message)}}
const itemUrl=id=>`/api/meetings/${meetingId}/minutes/items/${id}`;

// --- Item cards ---
function ownerSelect(item){
  const select=el('select',{className:'input compact',ariaLabel:'負責人'},el('option',{value:'',textContent:'未指派'}),
    ...data.members.map(m=>el('option',{value:m.username,textContent:m.displayName===m.username?m.username:`${m.displayName}（${m.username}）`})));
  select.value=item.owner||'';
  select.onchange=()=>act(async()=>replaceItem(await call('PATCH',itemUrl(item.id),{version:item.version,owner:select.value||null})));
  return select;
}
function dueInput(item){
  const input=el('input',{className:'input compact',type:'date',value:item.dueDate||'',ariaLabel:'到期日'});
  input.onchange=()=>act(async()=>replaceItem(await call('PATCH',itemUrl(item.id),{version:item.version,dueDate:input.value||null})));
  return input;
}
function evidence(item){
  const source=seq=>meeting?.segments.find(s=>s.seq===seq)?.source;
  return item.evidence.length?el('div',{className:'evidence'},el('span',{className:'muted small',textContent:'證據'}),
    ...item.evidence.map(e=>el('a',{className:'chip',href:`/meetings/${meetingId}#seg-${e.seq}`,textContent:`▸ ${clock(e.startMs)}`,
      title:source(e.seq)||`第 ${e.seq} 段`,onclick:event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openPeek(item.id,e.seq)}}))):null;
}

// --- Evidence side panel: the cited segments with one segment of context each side, playable in place ---
// subject: an item of these minutes, or {label, content, evidence} for a progress suggestion.
function openPeek(itemId,focusSeq,subject=null){peeking={itemId,focusSeq,subject};renderPeek();render()}
function closePeek(){peeking=null;$('player').pause();renderPeek();render()}
function renderPeek(){
  const item=peeking&&(peeking.subject||data.items.find(i=>i.id===peeking.itemId));
  // Below the sticky top bar, so the account and theme buttons stay reachable.
  document.documentElement.style.setProperty('--peek-top',`${document.querySelector('.topbar').offsetHeight}px`);
  document.body.classList.toggle('peeking',!!item);$('peek').hidden=!item;
  if(!item){peeking=null;return}
  $('peekKind').textContent=item.label||`${Object.fromEntries(KINDS)[item.kind]}的證據`;
  $('peekTitle').textContent=item.content;
  if(!meeting){$('peekList').replaceChildren(el('p',{className:'muted small',textContent:'載入逐字稿中…'}));return}
  const rows=MeetingTimeline.evidenceContext(meeting.segments,item.evidence.map(e=>e.seq)).flatMap(({segment,cited,gapBefore})=>
    [gapBefore?el('div',{className:'peek-gap',textContent:'⋯'}):null,peekRow(segment,cited)].filter(Boolean));
  $('peekList').replaceChildren(...rows);
  $(`peek-${peeking.focusSeq}`)?.scrollIntoView({block:'nearest'});
}
function peekRow(segment,cited){
  let playButton=null;
  if(meeting.hasRecording){
    playButton=el('button',{type:'button',className:'peek-play',title:'播放／暫停這段錄音',onclick:()=>togglePlay(segment)});
    playButton.dataset.play=segment.seq;
  }
  const row=el('div',{className:`peek-seg${cited?' cited':''}${segment.seq===peeking.focusSeq?' focus':''}`,id:`peek-${segment.seq}`},
    el('div',{className:'peek-seg-head'},
      playButton||el('span',{className:'peek-time',textContent:clock(segment.startMs)}),
      cited?el('a',{className:'text-button',href:`/meetings/${meetingId}#seg-${segment.seq}`,textContent:'到校對頁修正'}):null),
    el('p',{className:'peek-source',textContent:segment.source}),
    segment.target?el('p',{className:'peek-target',textContent:segment.target}):null);
  if(playButton)syncButton(playButton);
  return row;
}
// Playback: the button plays, pauses and resumes its segment; another segment, or a finished clip, loads afresh.
let clip=null;   // {seq, span} loaded in the player
function togglePlay(segment){
  const player=$('player');
  if(clip?.seq!==segment.seq||player.ended)return play(segment);
  if(player.paused)player.play().catch(error=>notice(error.message));else player.pause();
  syncPlayer();
}
function syncButton(button){
  const player=$('player'),seq=Number(button.dataset.play),segment=meeting.segments.find(s=>s.seq===seq);
  const loaded=clip?.seq===seq&&!player.ended,playing=loaded&&!player.paused;
  button.textContent=playing?`❚❚ ${clock(clip.span.start+player.currentTime*1000)}`:loaded&&player.currentTime>0?`▶ 繼續 ${clock(clip.span.start+player.currentTime*1000)}`:`▶ ${clock(segment.startMs)}`;
  button.classList.toggle('playing',playing);
}
function syncPlayer(){document.querySelectorAll('.peek-play').forEach(syncButton)}
async function play(segment){
  const span=MeetingTimeline.playWindow(segment.startMs,segment.endMs,meeting.durationMs||Infinity);
  try{
    const response=await fetch(`/api/meetings/${meetingId}/audio?start=${span.start}&end=${span.end}`);
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法載入錄音');
    if(audioUrl)URL.revokeObjectURL(audioUrl);
    audioUrl=URL.createObjectURL(await response.blob());
    clip={seq:segment.seq,span};$('player').src=audioUrl;await $('player').play();
  }catch(error){notice(error.message)}
}
for(const event of ['play','pause','ended','timeupdate'])$('player').addEventListener(event,syncPlayer);
$('peekClose').onclick=closePeek;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&peeking)closePeek()});
function editor(item){
  const kind=el('select',{className:'input compact',ariaLabel:'類型'},...KINDS.map(([k,l])=>el('option',{value:k,textContent:l})));kind.value=item.kind;
  const text=el('textarea',{className:'input editor',value:item.content,rows:2,maxLength:500,ariaLabel:'內容'});
  const save=el('button',{type:'submit',className:'primary-button compact',textContent:'儲存'});
  queueMicrotask(()=>text.focus());
  return el('form',{className:'edit-form',onsubmit:event=>{event.preventDefault();save.disabled=true;
    act(async()=>{replaceItem(await call('PATCH',itemUrl(item.id),{version:item.version,kind:kind.value,content:text.value}));editing=null;render()}).finally(()=>{save.disabled=false})}},
    kind,text,el('div',{className:'edit-buttons'},save,el('button',{type:'button',className:'text-button',textContent:'取消',onclick:()=>{editing=null;render()}})));
}
function card(item){
  const decide=action=>act(async()=>replaceItem(await call('POST',`${itemUrl(item.id)}/${action}`,{version:item.version})));
  const head=el('div',{className:'item-head'},
    el('span',{className:`chip state-${item.state}`,textContent:STATE[item.state]}),
    item.origin==='manual'?el('span',{className:'muted small',textContent:'手動新增'}):null,
    item.confirmedBy&&item.state==='confirmed'?el('span',{className:'muted small',textContent:`${item.confirmedBy} 確認`}):null);
  const body=editing===item.id?editor(item):el('p',{className:'item-content',textContent:item.content});
  const fields=item.kind==='action'?el('div',{className:'item-fields'},
    el('label',{},'負責人',ownerSelect(item)),
    el('label',{},'到期日',dueInput(item)),
    item.dueText?el('span',{className:'muted small',textContent:`原話：「${item.dueText}」`}):null,
    !item.owner&&item.ownerHint?el('span',{className:'hint-name',textContent:`模型提到「${item.ownerHint}」，不是團隊成員`}):null):null;
  const actions=el('div',{className:'item-actions'},
    item.state!=='confirmed'?el('button',{type:'button',className:'secondary-button compact',textContent:'確認',onclick:()=>decide('confirm')}):null,
    item.state!=='rejected'?el('button',{type:'button',className:'text-button danger',textContent:'駁回',onclick:()=>decide('reject')}):null,
    editing===item.id?null:el('button',{type:'button',className:'text-button',textContent:'修改',onclick:()=>{editing=item.id;render()}}));
  // A confirmed action is tracked (action-tracking): status, overdue days and history.
  const tracking=item.kind==='action'&&item.state==='confirmed'?ActionStatus.control(item,{meetingId,onChange:(next,message)=>{replaceItem(next);notice(message)},onError:notice}):null;
  return el('article',{className:`card item ${item.state}${peeking?.itemId===item.id?' peeked':''}${item.id===linkedId?' linked':''}`,id:`item-${item.id}`},head,body,fields,tracking,evidence(item),actions);
}
function addForm(kind){
  const text=el('textarea',{className:'input editor',rows:2,maxLength:500,placeholder:'內容',ariaLabel:'新條目內容'});
  const owner=kind==='action'?el('select',{className:'input compact',ariaLabel:'負責人'},el('option',{value:'',textContent:'未指派'}),...data.members.map(m=>el('option',{value:m.username,textContent:m.displayName}))):null;
  const due=kind==='action'?el('input',{className:'input compact',type:'date',ariaLabel:'到期日'}):null;
  queueMicrotask(()=>text.focus());
  return el('form',{className:'card item add-form',onsubmit:event=>{event.preventDefault();
    act(async()=>{replaceItem(await call('POST',`/api/meetings/${meetingId}/minutes/items`,{kind,content:text.value,owner:owner?.value||null,dueDate:due?.value||null}));adding=null;render()})}},
    text,kind==='action'?el('div',{className:'item-fields'},el('label',{},'負責人',owner),el('label',{},'到期日',due)):null,
    el('div',{className:'edit-buttons'},el('button',{type:'submit',className:'primary-button compact',textContent:'新增'}),el('button',{type:'button',className:'text-button',textContent:'取消',onclick:()=>{adding=null;render()}})));
}

// --- Page ---
function renderStatus(){
  const running=data.status==='running';
  $('generate').textContent=running?'產生中…':data.items.some(i=>i.origin==='ai')||data.summary?'重新產生':'產生紀要';
  $('generate').disabled=running||!data.modelAvailable;
  const done=data.finishedAt?new Date(data.finishedAt).toLocaleString('zh-TW',{hour12:false}):'';
  $('status').textContent=!data.modelAvailable?'紀要模型未設定，無法產生（請在 .env 設定 MINUTES_* 或 TRANSLATE_REFINE_*）':
    running?'正在產生紀要，通常需要數秒到一分鐘…':data.status==='failed'?data.message:
    data.status==='done'?`${done} 產生完成${data.dropped?`；${data.dropped} 條因沒有證據段落而略過`:''}。重新產生只會替換「待確認」的 AI 條目。`:'還沒有產生紀要。';
  $('status').className=`status-line ${data.status}`;
}
// Open editors keep what the user typed across a redraw (e.g. when a generation finishes).
function draftFields(){return [...document.querySelectorAll('#sections form textarea, #sections form select, #sections form input')]}
function render(){
  const drafts=draftFields().map(field=>field.value);
  renderStatus();
  $('summary').textContent=data.summary||'（尚無摘要）';
  $('summary').hidden=summaryEditing;$('summaryForm').hidden=!summaryEditing;
  $('sections').replaceChildren(...KINDS.map(([kind,label])=>{
    const items=data.items.filter(i=>i.kind===kind);
    const pending=items.filter(i=>i.state==='proposed').length;
    return el('section',{className:'kind-section'},
      el('div',{className:'section-head'},el('h2',{},label,el('span',{className:'count',textContent:String(items.filter(i=>i.state!=='rejected').length)}),
        pending?el('span',{className:'muted small',textContent:`${pending} 條待確認`}):null),
        el('button',{type:'button',className:'text-button',textContent:'＋ 新增',onclick:()=>{adding=kind;render()}})),
      adding===kind?addForm(kind):null,
      ...(items.length?items.map(card):adding===kind?[]:[el('p',{className:'muted small empty-kind',textContent:'沒有條目'})]));
  }));
  const fields=draftFields();
  if(fields.length===drafts.length)fields.forEach((field,i)=>{field.value=drafts[i]});
  // The panel follows its item: closed when a regeneration replaced it, retitled after an edit.
  if(peeking&&!peeking.subject){const item=data.items.find(i=>i.id===peeking.itemId);if(item)$('peekTitle').textContent=item.content;else closePeek()}
  renderProgress();
}
async function load(){
  const polling=data?.status==='running';
  data=await call('GET',`/api/meetings/${meetingId}/minutes`);
  // While generating, polls only refresh the status: redrawing the items would wipe an open editor.
  if(polling&&data.status==='running'){renderStatus();poll=setTimeout(()=>load().catch(error=>notice(error.message)),2000);return}
  $('modelNote').textContent=data.modelAvailable?` 產生時整場逐字稿會傳送到外部模型服務${data.model?`（${data.model}）`:''}。`:'';
  render();
  // From the board (#item-N): bring that item into view once.
  const linked=!linkedShown&&linkedId&&$(`item-${linkedId}`);
  if(linked){linkedShown=true;linked.scrollIntoView({block:'center'})}
  clearTimeout(poll);if(data.status==='running')poll=setTimeout(()=>load().catch(error=>notice(error.message)),2000);
}

$('download').href=`/api/meetings/${meetingId}/minutes.md`;
// Someone else may already be generating (409): either way, show the current state and keep polling.
$('generate').onclick=()=>act(async()=>{try{await call('POST',`/api/meetings/${meetingId}/minutes/generate`)}finally{await load()}});
$('editSummary').onclick=()=>{summaryEditing=true;$('summaryInput').value=data.summary;render();$('summaryInput').focus()};
$('cancelSummary').onclick=()=>{summaryEditing=false;render()};
$('summaryForm').onsubmit=event=>{event.preventDefault();act(async()=>{
  const response=await fetch(`/api/meetings/${meetingId}/minutes/summary`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({version:data.summaryVersion,summary:$('summaryInput').value})});
  const result=await response.json();
  if(response.status===409){data.summary=result.summary;data.summaryVersion=result.summaryVersion;summaryEditing=false;render();throw new Error(result.detail)}
  if(!response.ok)throw new Error(result.detail||'儲存失敗');
  data.summary=result.summary;data.summaryVersion=result.summaryVersion;summaryEditing=false;render();
})};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
load().catch(error=>notice(error.message));
// The header and the evidence panel come from the meeting itself (same as the review page).
// --- Progress suggestions left from the meeting (meeting-series) ---
const PROGRESS={doing:'可能已開始',done:'可能已完成',cancelled:'可能取消'};
let progress=[];
function renderProgress(){
  const pending=progress.filter(s=>s.state==='pending');
  $('progress').hidden=!pending.length;
  $('progressCount').textContent=String(pending.length);
  $('progressList').replaceChildren(...pending.map(s=>{
    const decide=action=>act(async()=>{
      const {suggestion}=await call('POST',`/api/meetings/${meetingId}/progress/${s.id}/${action}`);
      progress=progress.map(x=>x.id===suggestion.id?suggestion:action==='accept'&&x.itemId===s.itemId&&x.state==='pending'?{...x,state:'dismissed'}:x);
      renderProgress();
    }).catch(()=>{});
    const subject={label:`進度提示：${PROGRESS[s.toStatus]}`,content:s.content,evidence:s.evidence};
    return el('article',{className:'progress-item',id:`progress-${s.id}`},
      el('p',{className:'item-content'},s.content),
      el('p',{className:'muted small'},el('b',{className:'progress-label',textContent:PROGRESS[s.toStatus]}),s.note?`：${s.note}`:null,
        ` （目前${ActionStatus.LABEL[s.fromStatus]} → ${ActionStatus.LABEL[s.toStatus]}）`),
      el('div',{className:'evidence'},el('span',{className:'muted small',textContent:'證據'}),
        ...s.evidence.map(e=>el('a',{className:'chip',href:`/meetings/${meetingId}#seg-${e.seq}`,textContent:`▸ ${clock(e.startMs)}`,title:e.source,
          onclick:event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openPeek(null,e.seq,subject)}}))),
      el('div',{className:'item-actions'},
        el('button',{type:'button',className:'secondary-button compact',textContent:'套用',onclick:()=>decide('accept')}),
        el('button',{type:'button',className:'text-button',textContent:'略過',onclick:()=>decide('dismiss')}),
        el('a',{className:'text-button',href:`/meetings/${s.itemMeetingId}/minutes#item-${s.itemId}`,textContent:'原會議的待辦'})));
  }));
}
call('GET',`/api/meetings/${meetingId}/progress`).then(list=>{progress=list;renderProgress()}).catch(()=>{});
call('GET',`/api/meetings/${meetingId}`).then(result=>{meeting=result;MeetingNav.show(meeting);if(data)render();if(peeking)renderPeek()}).catch(error=>notice(error.message));
