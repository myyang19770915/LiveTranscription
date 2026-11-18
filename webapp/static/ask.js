// 問答 page (meeting-qa): the question and filters live in the address (?q=&team=&series=&from=&to=) but a question is
// only sent when the user asks (every answer calls the model). The answer's [n] and the sources listed below it open the
// source in the side panel (evidence-panel.js), where it can be read in context and played, without leaving the page.
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
let params=new URLSearchParams(location.search),latest=0;
const FILTERS=['team','series','from','to'];
const QUESTION_MAX=300;
const KIND_LABEL={decision:'決議',action:'待辦',question:'問題',risk:'風險'};
const STATUS_LABEL={todo:'未開始',doing:'進行中',done:'已完成',cancelled:'已取消'};
const pad=n=>String(n).padStart(2,'0');
const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
const day=iso=>{if(!iso)return '';const d=new Date(iso);return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`};
function notice(message){$('notice').textContent=message||'';$('notice').hidden=!message}

function current(){return {q:$('q').value.trim(),team:$('team').value,series:$('series').value,from:$('from').value,to:$('to').value}}
function setParams(next){
  params=new URLSearchParams();
  for(const [k,v] of Object.entries(next))if(v)params.set(k,v);
  history.replaceState(null,'',params.toString()?`/ask?${params}`:'/ask');
  switchLink();
  $('clear').hidden=!FILTERS.some(k=>next[k]);
}
// The switch to full-text search carries what is in the box now and the filters.
function switchLink(){
  const carried=new URLSearchParams(Object.entries(current()).filter(([,v])=>v));
  $('toSearch').href=carried.toString()?`/search?${carried}`:'/search';
}

// Busy while the newest question is under way (as on the search page): the region says so at once, the previous answer
// is dimmed and cannot be clicked, and after 200 ms the polite summary says what is happening.
let slowTimer=0;
function busy(on){
  clearTimeout(slowTimer);
  $('answer').setAttribute('aria-busy',String(on));
  $('answer').classList.toggle('is-loading',on);
  if(on)slowTimer=setTimeout(()=>{$('summary').textContent='正在找資料並整理答案…';LoadingState.show($('answer'),'整理答案中…')},200);
  else LoadingState.hide($('answer'));
}

// The answer with every [n] as a link to source n.
function answerText(answer,numbers){
  const parts=[];let at=0;
  for(const m of answer.matchAll(/\[(\d+)\]/g)){
    if(m.index>at)parts.push(answer.slice(at,m.index).replace(/\s+$/,''));   // the model often writes a space before [n]
    const n=Number(m[1]);
    parts.push(numbers.has(n)?el('a',{className:'cite',href:`#src-${n}`,textContent:`[${n}]`,title:`查看出處 ${n}`,onclick:event=>{event.preventDefault();showSource(n)}}):m[0]);
    at=m.index+m[0].length;
  }
  parts.push(answer.slice(at));
  return parts;
}
// [n]: marks source n in the list and opens it in the side panel.
let sources=new Map();   // n → source of the answer shown
function showSource(n){
  const source=sources.get(n);if(!source)return;
  mark(n);
  $(`src-${n}`).scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  openSource(source);
}
function mark(n){for(const s of document.querySelectorAll('.source'))s.classList.toggle('is-target',s.id===`src-${n}`)}

// The side panel: a segment with one segment of context each side, playable; an item with its evidence segments.
const panel=EvidencePanel.create({notice,onClose:()=>mark(null)});
const meetings=new Map();   // meeting id → promise of /api/meetings/<id>, loaded once
function meetingOf(id){
  if(!meetings.has(id))meetings.set(id,fetch(`/api/meetings/${id}`).then(response=>{if(!response.ok)throw new Error('無法載入這場會議');return response.json()}));
  return meetings.get(id);
}
function facts(s){return [s.owner?`負責人 ${s.owner}`:'',s.due?`到期 ${s.due}`:'',s.status?STATUS_LABEL[s.status]:'',s.state==='proposed'?'待確認':''].filter(Boolean).join('・')}
let showing=0;
async function openSource(s){
  const ticket=++showing,segment=s.type==='segment';
  const view={kind:`出處 [${s.n}]・${segment?`逐字稿 ${clock(s.startMs)}`:KIND_LABEL[s.kind]||'紀要'}`,
    title:[s.title,day(s.startedAt)].filter(Boolean).join(' · '),meetingId:s.meetingId,meeting:null,
    cited:segment?[s.seq]:s.evidence||[],focusSeq:segment?s.seq:(s.evidence||[])[0],
    intro:segment?null:el('div',{className:'peek-item'},el('p',{className:'peek-source',textContent:s.text}),
      facts(s)?el('p',{className:'peek-target',textContent:facts(s)}):null,
      el('a',{className:'text-button',href:s.href,textContent:s.meetingId?'到紀要頁這一條':'到看板這一條'})),
    empty:s.meetingId?'這一條沒有附證據段落。':'看板新增的待辦沒有逐字稿。'};
  if(!s.meetingId){panel.show({...view,meeting:{segments:[],hasRecording:false}});return}
  panel.show(view);
  try{
    const meeting=await meetingOf(s.meetingId);
    if(ticket===showing&&panel.open)panel.show({...view,meeting});
  }catch(error){
    meetings.delete(s.meetingId);
    if(ticket===showing){panel.hide();notice(error.message)}
  }
}
function sourceItem(s){
  const segment=s.type==='segment';
  const where=[s.title,day(s.startedAt)].filter(Boolean).join(' · ');
  const tag=segment?el('span',{className:'hit-tag time',textContent:`▸ ${clock(s.startMs)}`}):el('span',{className:'hit-tag',textContent:KIND_LABEL[s.kind]||'紀要'});
  const details=segment?'':facts(s);
  // A plain click opens the side panel; Ctrl/⌘/Shift-click still opens the page itself.
  const open=event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();mark(s.n);openSource(s)};
  return el('li',{className:'source',id:`src-${s.n}`},
    el('div',{className:'source-head'},el('b',{className:'source-n',textContent:`[${s.n}]`}),el('span',{className:'result-meta',textContent:where})),
    el('a',{className:'source-link',href:s.href,onclick:open},tag,
      el('div',{},
        segment&&s.prev?el('p',{className:'source-context',textContent:s.prev}):null,
        el('p',{className:'hit-text',textContent:s.text}),
        segment&&s.target?el('p',{className:'hit-sub',textContent:s.target}):null,
        details?el('p',{className:'hit-sub',textContent:details}):null,
        segment&&s.next?el('p',{className:'source-context',textContent:s.next}):null,
        el('span',{className:'source-open',textContent:segment?'查看出處與錄音 ›':s.meetingId?'查看紀要與證據 ›':'查看待辦 ›'}))));
}

function render(result){
  panel.hide();
  sources=new Map((result.sources||[]).map(s=>[s.n,s]));
  const degraded=result.degraded?el('p',{className:'ask-note',textContent:'語意比對暫時無法使用，這次只用關鍵字找資料，換句話說的內容可能找不到。'}):null;
  if(result.notFound){
    $('summary').textContent='';
    $('answer').replaceChildren(el('div',{className:'card search-empty'},
      el('b',{textContent:'在你能看到的會議裡找不到相關內容'}),
      el('span',{},'可以換個問法、放寬篩選，或',el('a',{href:`/search?q=${encodeURIComponent(result.question)}`,textContent:'改用全文搜尋'}),'找確切的字。'),
      degraded));
    return;
  }
  const numbers=new Set(result.sources.map(s=>s.n));
  $('summary').textContent=`根據 ${result.sources.length} 筆資料回答`;
  $('answer').replaceChildren(
    el('article',{className:'card ask-answer'},el('p',{className:'ask-question',textContent:result.question}),
      el('p',{className:'ask-text'},...answerText(result.answer,numbers)),degraded,
      el('p',{className:'ask-caution',textContent:'回答由系統根據下列出處整理，重要決定請點開出處核對原文。'})),
    el('section',{className:'card ask-sources','aria-label':'出處'},el('h2',{textContent:'出處'}),el('ol',{className:'sources'},...result.sources.map(sourceItem))));
}
function idle(){
  $('summary').textContent='';
  $('answer').replaceChildren(el('div',{className:'card search-empty'},el('b',{textContent:'用一句話問會議裡談過的事'}),
    el('span',{textContent:'例如「上次跟客戶談價格的結論是什麼？」回答只根據你所屬團隊的會議逐字稿與紀要，每句都附出處。按 Enter 送出，Shift+Enter 換行。'})));
}

async function run(){
  const next=current();
  setParams(next);
  const ticket=++latest;   // also on an empty or invalid box, so a question still under way cannot fill it afterwards
  notice('');
  const problem=!next.q?'請輸入問題':[...next.q].length>QUESTION_MAX?`問題最多 ${QUESTION_MAX} 個字`:'';
  if(problem){
    busy(false);
    $('summary').textContent='';   // also when a question was under way: nothing is being looked up now
    if(next.q)$('answer').replaceChildren();
    $('q').setAttribute('aria-invalid','true');$('q').setAttribute('aria-describedby','notice');notice(problem);$('q').focus();
    return;
  }
  $('q').removeAttribute('aria-invalid');$('q').removeAttribute('aria-describedby');
  busy(true);
  try{
    const body={question:next.q,...Object.fromEntries(Object.entries(next).filter(([k,v])=>k!=='q'&&v).map(([k,v])=>[k,k==='team'||k==='series'?Number(v):v]))};
    const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>null);
    if(ticket!==latest)return;
    if(!response.ok){
      // A bookmarked team or series the user cannot see: drop the filters so the next question works.
      if(response.status===404&&(next.team||next.series)){$('team').value='';await loadSeries();setParams(current());throw new Error('找不到這個團隊或系列，已改為全部，請再問一次')}
      throw new Error(typeof result?.detail==='string'?result.detail:'問答失敗，請稍後再試');
    }
    render(result);
  }catch(error){
    if(ticket!==latest)return;   // a replaced question fails silently
    $('summary').textContent='';$('answer').replaceChildren();
    throw error;
  }finally{
    if(ticket===latest)busy(false);   // only the newest question ends the busy state
  }
}
const ask=()=>run().catch(error=>notice(error.message));

// Index progress and service state for the chosen team (or all).
async function loadState(){
  const response=await fetch(`/api/ask/status${$('team').value?`?team=${$('team').value}`:''}`).catch(()=>null);
  const state=response?.ok?await response.json():null;
  let text='';
  if(state&&!state.configured)text='問答功能尚未設定，請聯絡系統管理員。';
  else if(state&&!state.embedReachable)text='語意比對服務目前無法使用，問答只會用關鍵字找資料。';
  else if(state&&state.indexed<state.total)text=`還在建立索引（已完成 ${state.indexed} / ${state.total} 筆），剛加入的內容可能還找不到。`;
  $('indexState').textContent=text;$('indexState').hidden=!text;
}

// Series of the chosen team, or of all the user's teams (named with the team).
let teams=[];
async function loadSeries(selected=''){
  const chosen=teams.filter(t=>!$('team').value||String(t.id)===$('team').value);
  const lists=await Promise.all(chosen.map(t=>fetch(`/api/teams/${t.id}/series`).then(r=>r.ok?r.json():[]).catch(()=>[])
    .then(list=>list.map(s=>({...s,label:chosen.length>1?`${t.name} · ${s.name}`:s.name})))));
  $('series').replaceChildren(el('option',{value:'',textContent:'全部'}),...lists.flat().map(s=>el('option',{value:s.id,textContent:s.label})));
  $('series').value=lists.flat().some(s=>String(s.id)===selected)?selected:'';
}

$('askForm').onsubmit=event=>{event.preventDefault();ask()};
// Enter asks, Shift+Enter starts a new line; Enter that confirms an input method's composition does neither.
$('q').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();ask()}};
$('q').oninput=()=>{switchLink();if($('q').hasAttribute('aria-invalid')&&$('q').value.trim()&&[...$('q').value.trim()].length<=QUESTION_MAX){$('q').removeAttribute('aria-invalid');$('q').removeAttribute('aria-describedby');notice('')}};
// Filters only change the address; the next question uses them.
$('team').onchange=async()=>{await loadSeries();setParams(current());loadState()};
for(const id of ['series','from','to'])$(id).onchange=()=>setParams(current());
$('clear').onclick=async()=>{$('team').value='';$('from').value='';$('to').value='';await loadSeries();setParams(current());loadState()};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};

// The address is restored at once (never sent); teams and series follow the account.
$('q').value=params.get('q')||'';
$('from').value=params.get('from')||'';$('to').value=params.get('to')||'';
idle();
$('q').focus();
window.accountSoon.then(async me=>{   // page-switching: the remembered account fills the menus at once
  teams=me.teams||[];
  $('team').append(...teams.map(t=>el('option',{value:t.id,textContent:t.name})));
  $('team').value=teams.some(t=>String(t.id)===params.get('team'))?params.get('team'):'';
  await loadSeries(params.get('series')||'');
  const dropped=(params.get('team')&&!$('team').value)||(params.get('series')&&!$('series').value);
  setParams(current());
  if(dropped)notice('找不到這個團隊或系列，已改為全部');
  loadState();
});
