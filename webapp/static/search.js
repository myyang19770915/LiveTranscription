// Full-text search page (meeting-search): the query and filters live in the address (?q=&team=&series=&from=&to=&kind=);
// results are grouped by meeting, the terms are marked, and every hit links to where it came from.
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
let params=new URLSearchParams(location.search),latest=0;
const FILTERS=['team','series','from','to','kind'];
const KIND_LABEL={decision:'決議',action:'待辦',question:'問題',risk:'風險'};
const STATUS_LABEL={todo:'未開始',doing:'進行中',done:'已完成',cancelled:'已取消'};
const pad=n=>String(n).padStart(2,'0');
const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
function setParams(next){
  params=new URLSearchParams();
  for(const [k,v] of Object.entries(next))if(v&&!(k==='kind'&&v==='all'))params.set(k,v);
  history.replaceState(null,'',params.toString()?`/search?${params}`:'/search');
  switchLink();
}
// The switch to 問答 (meeting-qa) carries what is in the box now and the filters it shares (not the kind).
function switchLink(){
  const carried=new URLSearchParams([...params].filter(([k])=>k!=='kind'&&k!=='q'));
  if($('q').value.trim())carried.set('q',$('q').value.trim());
  $('toAsk').href=carried.toString()?`/ask?${carried}`:'/ask';
}
function notice(message){$('notice').textContent=message||'';$('notice').hidden=!message}

// The same limits as webapp/search.py, checked before sending; the reason in the API's own words, '' when it can be sent.
const QUERY_MAX=100,MAX_TERMS=5;
function invalidQuery(q){
  if([...q].length>QUERY_MAX)return `搜尋字最多 ${QUERY_MAX} 個字`;
  const count=q.split(/\s+/).filter(Boolean).length;
  return count>MAX_TERMS?`搜尋詞最多 ${MAX_TERMS} 個（目前 ${count} 個），請刪減後再搜尋`:'';
}
// Busy while the newest search is under way: the results region says so at once (aria-busy), the old results are dimmed
// and cannot be clicked, and after 200 ms the polite summary says what is being searched, so quick searches do not flicker.
// An invalid box is described by the alert saying why; other notices (a dropped filter, a failure) do not describe it.
function invalidBox(on){
  for(const [name,value] of [['aria-invalid','true'],['aria-describedby','notice']])on?$('q').setAttribute(name,value):$('q').removeAttribute(name);
}
let slowTimer=0;
function busy(on,q=''){
  clearTimeout(slowTimer);
  $('results').setAttribute('aria-busy',String(on));
  $('results').classList.toggle('is-loading',on);
  if(on)slowTimer=setTimeout(()=>{$('summary').textContent=`正在搜尋「${q}」…`;LoadingState.show($('results'),'搜尋中…')},200);
  else LoadingState.hide($('results'));
}

// The text with every term wrapped in <mark>, case-insensitively; overlapping terms merge.
function marked(text,terms){
  const lower=text.toLowerCase(),spans=[];
  for(const term of terms){
    const t=term.toLowerCase();if(!t)continue;
    for(let i=lower.indexOf(t);i>=0;i=lower.indexOf(t,i+t.length))spans.push([i,i+t.length]);
  }
  spans.sort((a,b)=>a[0]-b[0]);
  const parts=[];let at=0;
  for(const [s,e] of spans){
    if(e<=at)continue;
    const start=Math.max(s,at);
    if(start>at)parts.push(text.slice(at,start));
    parts.push(el('mark',{textContent:text.slice(start,e)}));at=e;
  }
  parts.push(text.slice(at));
  return parts;
}

function hitRow(group,hit,terms){
  let href,tag,body;
  if(hit.type==='segment'){
    href=`/meetings/${group.meetingId}#seg-${hit.seq}`;
    tag=el('span',{className:'hit-tag time',textContent:`▸ ${clock(hit.startMs)}`});
    body=[el('p',{className:'hit-text'},...marked(hit.source,terms)),hit.target?el('p',{className:'hit-sub'},...marked(hit.target,terms)):null];
  }else if(hit.type==='item'){
    href=group.meetingId?`/meetings/${group.meetingId}/minutes#item-${hit.id}`:`/actions?item=${hit.id}`;
    tag=el('span',{className:'hit-tag',textContent:KIND_LABEL[hit.kind]||'紀要'});
    const state=hit.state==='proposed'?'待確認':hit.status?STATUS_LABEL[hit.status]:'';
    body=[el('p',{className:'hit-text'},...marked(hit.content,terms),state?el('span',{className:'hit-state',textContent:`（${state}）`}):null)];
  }else{
    href=`/meetings/${group.meetingId}`;
    tag=el('span',{className:'hit-tag',textContent:'主題'});
    body=[el('p',{className:'hit-text'},...marked(group.title||'',terms))];
  }
  return el('li',{className:'hit'},el('a',{href},tag,el('div',{},...body)));
}
function groupCard(group,terms){
  const when=group.startedAt?new Date(group.startedAt):null;
  const title=group.meetingId?MeetingCatalog.displayTitle({title:group.title,startedAt:group.startedAt}):'看板待辦';
  const date=when?`${when.getFullYear()}/${when.getMonth()+1}/${when.getDate()}`:'';
  return el('article',{className:'card result-group'},
    el('div',{className:'result-head'},
      group.meetingId?el('a',{href:`/meetings/${group.meetingId}`,textContent:title}):el('b',{textContent:title}),
      el('span',{className:'result-meta',textContent:[group.team,group.series,date].filter(Boolean).join(' · ')}),
      el('span',{className:'result-count',textContent:`${group.hits.length} 筆`})),
    el('ul',{className:'hits'},...group.hits.map(hit=>hitRow(group,hit,terms))));
}

function render(result){
  const meetings=result.groups.length;
  $('summary').textContent=result.total?`找到 ${result.total} 筆，來自 ${meetings} 個來源${result.truncated?'；結果太多，只列出前 300 筆，請加詞或篩選縮小範圍':''}`:'';
  $('results').replaceChildren(...(result.total?result.groups.map(g=>groupCard(g,result.terms)):[
    el('div',{className:'card search-empty'},el('b',{textContent:`沒有找到「${result.query}」`}),
      el('span',{textContent:'試試換個詞、只輸入其中一部分，或放寬篩選條件。'}))]));
}
function idle(){
  $('summary').textContent='';
  $('results').replaceChildren(el('div',{className:'card search-empty'},el('b',{textContent:'搜尋逐字稿、紀要與會議主題'}),
    el('span',{textContent:'多個詞用空白分開（最多 5 個），會找同時出現的地方；按 / 可從任何頁面開啟搜尋。'})));
}

// carry: a notice to show with these results (a dropped filter), cleared otherwise.
async function run(carry=''){
  const q=$('q').value.trim(),kind=document.querySelector('.kind[aria-pressed="true"]')?.dataset.kind||'all';
  const next={q,team:$('team').value,series:$('series').value,from:$('from').value,to:$('to').value,kind};
  setParams(next);
  $('clear').hidden=!FILTERS.some(k=>k==='kind'?kind!=='all':next[k]);
  const ticket=++latest;   // also on an empty or invalid box, so a search still under way cannot fill it afterwards
  notice(carry);
  const problem=q?invalidQuery(q):'';
  invalidBox(Boolean(problem));
  if(!q||problem){
    busy(false);
    // Not sent: the previous results go, so they are not taken for this query.
    if(problem){$('summary').textContent='';$('results').replaceChildren();notice(problem)}else idle();
    return;
  }
  busy(true,q);
  try{
    const response=await fetch(`/api/search?${params}`);
    const result=await response.json().catch(()=>null);
    if(ticket!==latest)return;
    if(!response.ok){
      // A bookmarked team or series the user cannot see: drop it and search again.
      if(response.status===404&&(next.team||next.series)){$('team').value='';await loadSeries();return run('找不到這個團隊或系列，已改為搜尋全部')}
      throw new Error(typeof result?.detail==='string'?result.detail:'搜尋失敗');
    }
    render(result);
  }catch(error){
    if(ticket!==latest)return;   // a replaced search fails silently
    $('summary').textContent='';$('results').replaceChildren();
    throw error;
  }finally{
    if(ticket===latest)busy(false);   // only the newest search ends the busy state
  }
}
const search=(carry='')=>run(carry).catch(error=>notice(error.message));

// Series of the chosen team, or of all the user's teams (named with the team).
let teams=[];
async function loadSeries(selected=''){
  const chosen=teams.filter(t=>!$('team').value||String(t.id)===$('team').value);
  const lists=await Promise.all(chosen.map(t=>fetch(`/api/teams/${t.id}/series`).then(r=>r.ok?r.json():[]).catch(()=>[])
    .then(list=>list.map(s=>({...s,label:chosen.length>1?`${t.name} · ${s.name}`:s.name})))));
  $('series').replaceChildren(el('option',{value:'',textContent:'全部'}),...lists.flat().map(s=>el('option',{value:s.id,textContent:s.label})));
  $('series').value=lists.flat().some(s=>String(s.id)===selected)?selected:'';
}
function pressKind(kind){for(const b of document.querySelectorAll('.kind'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind))}

$('searchForm').onsubmit=event=>{event.preventDefault();search()};
// Fixing an invalid query clears the mark and its message at once (they are not live-checked while typing otherwise).
$('q').oninput=()=>{switchLink();if($('q').hasAttribute('aria-invalid')&&!invalidQuery($('q').value.trim())){invalidBox(false);notice('')}};
for(const b of document.querySelectorAll('.kind'))b.onclick=()=>{pressKind(b.dataset.kind);search()};
$('team').onchange=async()=>{await loadSeries();search()};
for(const id of ['series','from','to'])$(id).onchange=search;
$('clear').onclick=async()=>{$('team').value='';$('from').value='';$('to').value='';pressKind('all');await loadSeries();search()};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};

// The address is restored at once, so typing right away is never overwritten; teams and series follow the account.
$('q').value=params.get('q')||'';
$('from').value=params.get('from')||'';$('to').value=params.get('to')||'';
pressKind(['segments','items','meetings'].includes(params.get('kind'))?params.get('kind'):'all');
$('q').focus();
window.accountReady.then(async me=>{
  teams=me.teams||[];
  $('team').append(...teams.map(t=>el('option',{value:t.id,textContent:t.name})));
  $('team').value=teams.some(t=>String(t.id)===params.get('team'))?params.get('team'):'';
  const wanted={team:params.get('team'),series:params.get('series')};
  await loadSeries(wanted.series||'');
  const dropped=(wanted.team&&!$('team').value)||(wanted.series&&!$('series').value);
  search(dropped?'找不到這個團隊或系列，已改為搜尋全部':'');
});
