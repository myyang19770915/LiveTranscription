// Meeting minutes: generate with the minutes model, then confirm, correct or reject each item.
const $=id=>document.getElementById(id);
const meetingId=location.pathname.split('/').filter(Boolean).at(-2);
const KINDS=[['decision','決議'],['action','待辦'],['question','待確認問題'],['risk','風險']];
const STATE={proposed:'待確認',confirmed:'已確認',rejected:'已駁回'};
let data=null,editing=null,adding=null,summaryEditing=false,poll=null;
let meeting=null,peeking=null,linkedShown=false;   // meeting: /api/meetings/<id> (header and evidence segments)
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

// --- Evidence side panel (evidence-panel.js): the cited segments with one segment of context each side, playable in place ---
// subject: an item of these minutes, or {label, content, evidence} for a progress suggestion.
const panel=EvidencePanel.create({notice,onClose:()=>{peeking=null;render()}});
function openPeek(itemId,focusSeq,subject=null){peeking={itemId,focusSeq,subject};renderPeek();render()}
function closePeek(){peeking=null;panel.hide();render()}
function renderPeek(){
  const item=peeking&&(peeking.subject||data.items.find(i=>i.id===peeking.itemId));
  if(!item){peeking=null;panel.hide();return}
  panel.show({kind:item.label||`${Object.fromEntries(KINDS)[item.kind]}的證據`,title:item.content,meetingId,meeting,
    cited:item.evidence.map(e=>e.seq),focusSeq:peeking.focusSeq});
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
    item.confirmedBy&&item.state==='confirmed'?el('span',{className:'muted small',textContent:`${item.confirmedBy} 確認`}):null,
    evidence(item));   // the cited segments sit in the head row (review-minutes-polish)
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
  const tracking=item.kind==='action'&&item.state==='confirmed'?ActionStatus.control(item,{url:itemUrl(item.id),onChange:(next,message)=>{replaceItem(next);notice(message)},onError:notice}):null;
  return el('article',{className:`card item ${item.state}${peeking?.itemId===item.id?' peeked':''}${item.id===linkedId?' linked':''}`,id:`item-${item.id}`},head,body,tracking,el('div',{className:'item-foot'},fields,actions));
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
  if(peeking&&!peeking.subject){if(data.items.some(i=>i.id===peeking.itemId))renderPeek();else closePeek()}
  renderProgress();
  renderMail();
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
        // A board item (board-created-actions) has no meeting: it opens on the board.
        s.itemMeetingId?el('a',{className:'text-button',href:`/meetings/${s.itemMeetingId}/minutes#item-${s.itemId}`,textContent:'原會議的待辦'})
          :el('a',{className:'text-button',href:`/actions?item=${s.itemId}`,textContent:'看板上的待辦'})));
  }));
}
call('GET',`/api/meetings/${meetingId}/progress`).then(list=>{progress=list;renderProgress()}).catch(()=>{});
call('GET',`/api/meetings/${meetingId}`).then(result=>{meeting=result;MeetingNav.show(meeting);if(data)render();if(peeking)renderPeek()}).catch(error=>notice(error.message));

// --- Finalize and send (minutes-mail) ---
const when=iso=>new Date(iso).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
let mailBusy=false,mailMessage=null;   // [text, 'ok'|'warn'] from the last action
// Who last changed where the team's minutes go (mail-settings-audit); an administrator from outside the team is a warning.
function mailChangeLine(change){
  if(!change)return null;
  if(change.member)return [`寄送設定由 ${change.by} 於 ${when(change.at)} 修改`,''];
  const target=change.target==='team'?`改寄團隊信箱 ${change.address}`:'改寄給成員的個人信箱';
  return [`寄送設定由 ${change.by}（系統管理員，非團隊成員）於 ${when(change.at)} 修改：${target}${change.auto?'，定稿後自動寄送':''}`,'warn'];
}
function renderMail(){
  const mail=data.mail;
  $('finalState').textContent=data.finalizedAt?`已定稿・${when(data.finalizedAt)}・${data.finalizedBy}`:'尚未定稿';
  $('finalState').classList.toggle('done',!!data.finalizedAt);
  $('finalize').hidden=!!data.finalizedAt;
  $('finalize').disabled=mailBusy;
  $('finalize').title=mail.auto?'定稿後會自動寄送紀要':'';
  $('sendMail').textContent=mailBusy?'寄送中…':mail.last?.ok?'再寄一次':'寄送紀要';
  $('sendMail').disabled=mailBusy||!mail.configured;
  $('sendMail').title=mail.configured?'':'尚未設定寄信伺服器（SMTP_HOST）';
  const to=mail.target==='team'?`寄到團隊信箱 ${mail.address}`:`寄給 ${mail.recipients} 位成員的個人信箱`;
  const lines=[];
  if(!mail.configured)lines.push(['尚未設定寄信伺服器（請在 .env 設定 SMTP_HOST），目前只能定稿。','warn']);
  else lines.push([`${to}${mail.auto?'；定稿後自動寄送':''}。${mail.target==='members'&&mail.missing.length?`沒有 Email：${mail.missing.join('、')}。`:''}`,'']);
  const change=mailChangeLine(mail.lastChange);
  if(change)lines.push(change);
  const last=mail.last;
  if(last)lines.push(last.ok?[`最近寄送：${when(last.sentAt)}・${last.sentBy}${last.trigger==='auto'?'（定稿自動寄送）':''}・寄給 ${last.recipients} 人${last.skipped.length?`，未寄到 ${last.skipped.join('、')}（沒有 Email）`:''}。`,'ok']
    :[`最近一次寄送失敗（${when(last.sentAt)}・${last.sentBy}）：${last.error}`,'error']);
  if(mailMessage)lines.unshift(mailMessage);
  $('mailInfo').replaceChildren(...lines.map(([text,kind])=>el('span',{className:`mail-line ${kind}`,textContent:text})));
}
function mailSettingsOpen(open){
  $('mailSettings').hidden=!open;$('mailSettingsToggle').setAttribute('aria-expanded',String(open));
  if(!open)return;
  const mail=data.mail;
  for(const radio of $('mailSettings').elements.target)radio.checked=radio.value===mail.target;
  $('mailAddress').value=mail.address;$('mailAuto').checked=mail.auto;
  syncAddress();
}
function syncAddress(){const team=$('mailSettings').elements.target.value==='team';$('mailAddress').disabled=!team;$('mailAddress').required=team}
async function mailAction(work){
  if(mailBusy)return;
  mailBusy=true;mailMessage=null;renderMail();
  try{await act(work)}finally{mailBusy=false;renderMail()}
}
$('finalize').onclick=()=>mailAction(async()=>{
  const result=await call('POST',`/api/meetings/${meetingId}/minutes/finalize`);
  // A failed automatic send is already shown as the latest send; other notices (nothing to send, no SMTP) are not.
  const failed=result.mail.last&&!result.mail.last.ok;
  mailMessage=result.notice&&!failed?[result.notice,result.notice.includes('；')?'warn':'ok']:null;
  data=result;render();
});
$('sendMail').onclick=()=>mailAction(async()=>{
  try{const {last}=await call('POST',`/api/meetings/${meetingId}/minutes/send`);data.mail.last=last;mailMessage=['紀要已寄出','ok']}
  finally{data.mail=(await call('GET',`/api/meetings/${meetingId}/minutes`)).mail}
});
$('mailSettingsToggle').onclick=()=>mailSettingsOpen($('mailSettings').hidden);
$('mailSettingsCancel').onclick=()=>mailSettingsOpen(false);
$('mailSettings').onchange=event=>{if(event.target.name==='target')syncAddress()};
$('mailSettings').onsubmit=event=>{event.preventDefault();act(async()=>{
  const body={target:$('mailSettings').elements.target.value,address:$('mailAddress').value,auto:$('mailAuto').checked};
  await call('PUT',`/api/teams/${data.mail.teamId}/mail`,body);
  data.mail=(await call('GET',`/api/meetings/${meetingId}/minutes`)).mail;
  mailSettingsOpen(false);mailMessage=['寄送設定已儲存','ok'];renderMail();
})};
