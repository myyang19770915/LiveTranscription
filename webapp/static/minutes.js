// Meeting minutes: generate with the minutes model, then confirm, correct or reject each item.
const $=id=>document.getElementById(id);
const meetingId=location.pathname.split('/').filter(Boolean).at(-2);
const KINDS=[['decision','決議'],['action','待辦'],['question','待確認問題'],['risk','風險']];
const STATE={proposed:'待確認',confirmed:'已確認',rejected:'已駁回'};
let data=null,editing=null,adding=null,summaryEditing=false,poll=null;

function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const pad=n=>String(n).padStart(2,'0');
const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
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
  return item.evidence.length?el('div',{className:'evidence'},el('span',{className:'muted small',textContent:'證據'}),
    ...item.evidence.map(e=>el('a',{className:'chip',href:`/meetings/${meetingId}#seg-${e.seq}`,textContent:clock(e.startMs),title:`第 ${e.seq} 段`}))):null;
}
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
  return el('article',{className:`card item ${item.state}`},head,body,fields,evidence(item),actions);
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
}
async function load(){
  const polling=data?.status==='running';
  data=await call('GET',`/api/meetings/${meetingId}/minutes`);
  // While generating, polls only refresh the status: redrawing the items would wipe an open editor.
  if(polling&&data.status==='running'){renderStatus();poll=setTimeout(()=>load().catch(error=>notice(error.message)),2000);return}
  $('title').textContent=MeetingCatalog.displayTitle(data.meeting);document.title=`${$('title').textContent} 紀要 — 語橋 Live`;
  $('meta').replaceChildren(el('span',{className:'count',textContent:data.meeting.team}),el('span',{textContent:new Date(data.meeting.startedAt).toLocaleString('zh-TW',{hour12:false})}));
  $('modelNote').textContent=data.modelAvailable?` 產生時整場逐字稿會傳送到外部模型服務${data.model?`（${data.model}）`:''}。`:'';
  render();
  clearTimeout(poll);if(data.status==='running')poll=setTimeout(()=>load().catch(error=>notice(error.message)),2000);
}

$('reviewLink').href=`/meetings/${meetingId}`;
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
