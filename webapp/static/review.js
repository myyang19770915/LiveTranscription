// Post-meeting review: play each segment's recording, correct the transcript, retranslate it the way the
// live refinement pass does (translation-context.js), and keep every change in the segment's history.
const $=id=>document.getElementById(id);
const meetingId=location.pathname.split('/').filter(Boolean).pop();
const STATE={unreviewed:'未校對',confirmed:'已確認',edited:'已修改'};
const LANG={zh:'中文',en:'英文',ja:'日文',zh_ja:'中日雙向',auto:'中英自動',ko:'韓文',yue:'粵語',id:'印尼文'};
const EXTEND_MS=2000;
let meeting=null,segments=[],selected=null,extra={lead:0,tail:0},audioUrl=null;
const notes=new Map();     // seq -> {text, retry, next}: per-segment status line after an action

function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const pad=n=>String(n).padStart(2,'0');
function clock(ms){const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`}
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;if(message)setTimeout(()=>{if($('notice').textContent===message)$('notice').hidden=true},6000)}
async function call(method,url,body){
  const response=await fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if(response.status===409&&data.segment){replace(data.segment);notice(data.detail);const error=new Error(data.detail);error.stale=true;throw error}
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'操作失敗');
  return data;
}
function replace(segment){const i=segments.findIndex(s=>s.seq===segment.seq);if(i>=0)segments[i]=segment;render()}
const bySeq=seq=>segments.find(s=>s.seq===seq);

// --- Playback ---
async function play(seq){
  const segment=bySeq(seq);if(!segment||!meeting.hasRecording)return;
  const span=MeetingTimeline.playWindow(segment.startMs-extra.lead,segment.endMs+extra.tail,meeting.durationMs||Infinity);
  try{
    const response=await fetch(`/api/meetings/${meetingId}/audio?start=${span.start}&end=${span.end}`);
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法載入錄音');
    if(audioUrl)URL.revokeObjectURL(audioUrl);
    audioUrl=URL.createObjectURL(await response.blob());
    $('player').src=audioUrl;await $('player').play();
    notes.set(seq,{...notes.get(seq),playing:`播放 ${clock(span.start)}–${clock(span.end)}`});render();
  }catch(error){notice(error.message)}
}
function select(seq){
  if(selected!==seq){selected=seq;extra={lead:0,tail:0}}
  render();play(seq);
}

// --- Corrections ---
function finals(){return segments.map(s=>({source:s.source,target:s.target,detected:s.detected}))}
async function retranslate(seq,offerNext){
  const index=segments.findIndex(s=>s.seq===seq),segment=segments[index];
  const source=meeting.sourceLanguage||meeting.language,pair=source==='zh_ja',refine=$('refine').checked&&!$('refineRow').hidden;
  const {body,neighbours}=TranslationContext.refinementRequest(finals(),index,{source,target:meeting.targetLanguage||'zh',
    glossary:meeting.glossary,learned:meeting.learned,refine,tail:segments.slice(index+1).map(s=>s.source).join('')});
  notes.set(seq,{text:'重譯中…'});render();
  try{
    const result=await TranslationContext.translateStream(body);
    if(!TranslationContext.plausibleRefinement(segment.target,result.text,neighbours)){notes.set(seq,{text:'重譯結果重複了前後文，已保留原譯文'});render();return}
    const current=bySeq(seq);
    replace(await call('POST',`/api/meetings/${meetingId}/segments/${seq}/translation`,{version:current.version,target:TranslationContext.labelled(result.text,result.source,pair),refine}));
    const next=segments[index+1];
    notes.set(seq,{text:'已重譯',next:offerNext&&next?next.seq:null});render();
  }catch(error){
    if(error.stale)return;
    notes.set(seq,{text:'重譯失敗',retry:()=>retranslate(seq,offerNext)});render();
  }
}
async function saveEdit(seq,text,button){
  const segment=bySeq(seq);
  try{
    const updated=await call('POST',`/api/meetings/${meetingId}/segments/${seq}/edit`,{version:segment.version,source:text});
    editing=null;replace(updated);
    if(updated.version===segment.version){notes.set(seq,{text:'原文沒有變更'});render();return}
    await retranslate(seq,true);
  }catch(error){if(!error.stale){notice(error.message);button.disabled=false}}
}
async function confirmSegment(seq){
  try{replace(await call('POST',`/api/meetings/${meetingId}/segments/${seq}/confirm`,{version:bySeq(seq).version}));notes.set(seq,{text:'已確認'});render()}
  catch(error){if(!error.stale)notice(error.message)}
}
const KIND={edit:'修改原文',retranslate:'重譯',confirm:'確認正確'};
async function showHistory(seq){
  try{
    const entries=await call('GET',`/api/meetings/${meetingId}/segments/${seq}/history`);
    const asr=bySeq(seq).asrText;
    notes.set(seq,{...notes.get(seq),history:[{kind:'asr',text:`ASR 原文：${asr}`},...entries.map(h=>({kind:h.kind,
      text:`${new Date(h.at).toLocaleString('zh-TW',{hour12:false})} · ${h.displayName} · ${KIND[h.kind]}${h.refine?'（雲端）':''}`,
      detail:h.kind==='edit'?`${h.sourceBefore} → ${h.sourceAfter}`:h.kind==='retranslate'?`${h.targetBefore} → ${h.targetAfter}`:''}))]});
    render();
  }catch(error){notice(error.message)}
}

// --- Rendering ---
let editing=null;
function actions(segment){
  const seq=segment.seq,note=notes.get(seq)||{};
  const button=(text,onclick,cls='text-button')=>el('button',{type:'button',className:cls,textContent:text,onclick:event=>{event.stopPropagation();onclick()}});
  const bar=el('div',{className:'seg-actions'},
    meeting.hasRecording?button('▶ 重播',()=>play(seq)):el('span',{className:'muted small',textContent:'這場會議沒有錄音'}),
    meeting.hasRecording?button('往前 2 秒',()=>{extra.lead+=EXTEND_MS;play(seq)}):null,
    meeting.hasRecording?button('往後 2 秒',()=>{extra.tail+=EXTEND_MS;play(seq)}):null,
    el('span',{className:'spacer'}),
    button('修改原文',()=>{editing=seq;render()}),
    segment.state==='unreviewed'?button('確認正確',()=>confirmSegment(seq)):null,
    button('歷程',()=>showHistory(seq)));
  return [bar,status(segment),history(segment)];
}
// Shown on open rows, and on closed ones while something is happening to them ("一併重譯下一段").
function status(segment){
  const seq=segment.seq,note=notes.get(seq)||{};
  const button=(text,onclick,cls)=>el('button',{type:'button',className:cls,textContent:text,onclick:event=>{event.stopPropagation();onclick()}});
  return el('div',{className:'seg-note',ariaLive:'polite'},
    note.playing?el('span',{className:'muted small',textContent:note.playing}):null,
    note.text?el('span',{className:note.text.includes('失敗')||note.text.includes('重複')?'warn':'ok',textContent:note.text}):null,
    note.retry?button('重試',note.retry,'secondary-button compact'):null,
    note.next?button('一併重譯下一段',()=>{notes.set(seq,{...note,next:null});retranslate(note.next,false)},'secondary-button compact'):null);
}
function history(segment){
  const note=notes.get(segment.seq)||{};
  return note.history?el('ol',{className:'history'},...note.history.map(h=>el('li',{},el('span',{textContent:h.text}),h.detail?el('small',{textContent:h.detail}):null))):null;
}
function editor(segment){
  const area=el('textarea',{className:'input editor',value:segment.source,rows:3,ariaLabel:'修正後的原文'});
  const save=el('button',{type:'submit',className:'primary-button compact',textContent:'儲存並重譯'});
  const form=el('form',{className:'edit-form',onclick:event=>event.stopPropagation(),onsubmit:event=>{event.preventDefault();save.disabled=true;saveEdit(segment.seq,area.value,save)}},
    area,el('div',{className:'edit-buttons'},save,el('button',{type:'button',className:'text-button',textContent:'取消',onclick:()=>{editing=null;render()}})));
  queueMicrotask(()=>{area.focus();area.setSelectionRange(area.value.length,area.value.length)});
  return form;
}
function row(segment){
  const open=selected===segment.seq;
  const target=segment.target.replace(/^\[([^\]]*)\]\n/u,'');
  const label=segment.target.match(/^\[([^\]]*)\]\n/u)?.[1];
  const article=el('article',{className:`seg ${segment.state}${open?' open':''}`,id:`seg-${segment.seq}`},
    el('button',{type:'button',className:'seg-time',textContent:`${clock(segment.startMs)}–${clock(segment.endMs)}`,title:'播放這段',onclick:()=>select(segment.seq)}),
    editing===segment.seq?editor(segment):el('div',{className:'seg-source',textContent:segment.source,onclick:()=>select(segment.seq)}),
    el('div',{className:'seg-target',onclick:()=>select(segment.seq)},label?el('small',{className:'muted',textContent:label}):null,el('span',{textContent:target})),
    el('span',{className:`chip state-${segment.state}`,textContent:STATE[segment.state]}));
  if(open)article.append(el('div',{className:'seg-panel'},...actions(segment)));
  else if(notes.get(segment.seq)?.text)article.append(el('div',{className:'seg-panel'},status(segment)));
  return article;
}
function render(){
  $('segments').replaceChildren(...segments.map(row));
  const reviewed=segments.filter(s=>s.state!=='unreviewed').length;
  $('progressText').textContent=`已校對 ${reviewed} / ${segments.length} 段`;
  $('progressBar').style.width=`${segments.length?reviewed/segments.length*100:0}%`;
}
async function load(){
  meeting=await call('GET',`/api/meetings/${meetingId}`);
  segments=meeting.segments;
  const d=new Date(meeting.startedAt);
  $('title').textContent=`${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 的會議`;
  const source=meeting.sourceLanguage||meeting.language,target=meeting.targetLanguage;
  $('meta').replaceChildren(el('span',{className:'count',textContent:meeting.team}),
    el('span',{textContent:meeting.hasRecording?`錄音 ${clock(meeting.durationMs)}`:'沒有錄音'}),
    el('span',{textContent:source==='zh_ja'?'中日雙向':`${LANG[source]||source} → ${LANG[target]||target||''}`}),
    el('span',{textContent:`建立者 ${meeting.createdBy}`}));
  if(!segments.length)$('segments').replaceChildren(el('div',{className:'card empty'},el('b',{textContent:'這場會議沒有段落'}),el('p',{textContent:'會議中定稿的段落才會出現在這裡。'})));
  else render();
}
fetch('/api/config').then(r=>r.ok?r.json():{}).then(({cloudRefine})=>{$('refineRow').hidden=!cloudRefine}).catch(()=>{});
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
load().catch(error=>notice(error.message));
