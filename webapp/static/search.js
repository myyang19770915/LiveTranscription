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
}
function notice(message){$('notice').textContent=message||'';$('notice').hidden=!message}

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
    el('span',{textContent:'多個詞用空白分開，會找同時出現的地方；按 / 可從任何頁面開啟搜尋。'})));
}

// carry: a notice to show with these results (a dropped filter), cleared otherwise.
async function run(carry=''){
  const q=$('q').value.trim(),kind=document.querySelector('.kind[aria-pressed="true"]')?.dataset.kind||'all';
  const next={q,team:$('team').value,series:$('series').value,from:$('from').value,to:$('to').value,kind};
  setParams(next);
  $('clear').hidden=!FILTERS.some(k=>k==='kind'?kind!=='all':next[k]);
  const ticket=++latest;   // also on an empty box, so a search still under way cannot fill it afterwards
  notice(carry);
  if(!q){idle();return}
  const response=await fetch(`/api/search?${params}`);
  const result=await response.json().catch(()=>null);
  if(ticket!==latest)return;
  if(!response.ok){
    // A bookmarked team or series the user cannot see: drop it and search again.
    if(response.status===404&&(next.team||next.series)){$('team').value='';await loadSeries();return run('找不到這個團隊或系列，已改為搜尋全部')}
    throw new Error(typeof result?.detail==='string'?result.detail:'搜尋失敗');
  }
  render(result);
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
