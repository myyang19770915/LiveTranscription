// Outcome metrics page (outcome-metrics): stat tiles, the AI extraction split, the weekly chart and the transcript
// table, for the user's teams (or one) over the last 30 / 90 / 365 days. Filters live in the address (?team=&days=).
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const SVG='http://www.w3.org/2000/svg';
function svg(tag,attrs={},...children){const node=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);node.append(...children.filter(Boolean));return node}
let params=new URLSearchParams(location.search),latest=0,teamsLoaded=false;
const ENGINES={local:'本機',mai:'雲端',hybrid:'混合'};
const LANGUAGES={zh_ja:'中日雙向',auto:'中英自動',zh:'中文',en:'English',ja:'日本語',ko:'한국어',yue:'粵語'};
const pct=r=>r==null?'—':`${Math.round(r*1000)/10}%`;
const md=iso=>{const [,m,d]=iso.split('-').map(Number);return `${m}/${d}`};
function setParam(key,value){if(value)params.set(key,value);else params.delete(key);history.replaceState(null,'',params.toString()?`/metrics?${params}`:'/metrics')}
function notice(message){$('notice').textContent=message||'';$('notice').hidden=!message}

// --- Tiles ---
function tile(label,value,note,unit=''){
  return el('article',{className:'card tile'},el('p',{className:'tile-label',textContent:label}),
    el('p',{className:'tile-value'},value,unit&&value!=='—'?el('small',{textContent:unit}):null),el('p',{className:'tile-note',textContent:note}));
}
function hours(h){
  if(h==null)return ['—',''];
  return h>=48?[String(Math.round(h/24*10)/10),'天']:[String(Math.round(h*10)/10),'小時'];
}
function renderTiles(m){
  const a=m.actions,[lag,lagUnit]=hours(m.minutesLag.medianHours);
  $('tiles').replaceChildren(
    tile('待辦完成率',pct(a.completionRate),a.created?`期間建立 ${a.created} 件，已完成 ${a.done} 件${a.cancelled?`（另有 ${a.cancelled} 件取消，不計入）`:''}`:'期間內沒有建立待辦，資料不足'),
    tile('目前逾期率',pct(a.overdueRate),a.openWithDue?`有到期日的未完成待辦 ${a.openWithDue} 件，${a.overdue} 件逾期（不受期間影響）`:'目前沒有設定到期日的未完成待辦'),
    tile('準時完成率',pct(a.onTimeRate),a.finishedWithDue?`期間完成且有到期日 ${a.finishedWithDue} 件，${a.onTime} 件在到期日前完成`:'期間內沒有完成有到期日的待辦，資料不足'),
    tile('會後確認紀要',lag,m.minutesLag.meetings?`${m.minutesLag.meetings} 場會議，從會議結束到第一條紀要確認的中位數`:'期間內沒有已確認紀要的會議，資料不足',lagUnit));
}

// --- AI split: one whole, parts in a fixed order; a part too narrow for its share prints none (the table has it). ---
// 尚未處理 is the de-emphasis grey: its share prints in text ink, the others in white (palette guidance for fills).
const AI_PARTS=[['adopted','直接採用','var(--series-1)'],['edited','修改後採用','var(--series-2)'],['rejected','駁回','var(--series-3)'],['pending','尚未處理','var(--series-rest)']];
function renderAi(m){
  const total=AI_PARTS.reduce((n,[k])=>n+m.ai[k],0);
  if(!total){$('ai').replaceChildren(el('p',{className:'viz-empty',textContent:'期間內的會議還沒有 AI 抽取的條目。'}));return}
  const parts=AI_PARTS.filter(([k])=>m.ai[k]);
  const bar=el('div',{className:'split',role:'img',ariaLabel:`AI 抽取 ${total} 條：${parts.map(([k,l])=>`${l} ${m.ai[k]} 條（${pct(m.ai[k]/total)}）`).join('、')}`},
    ...parts.map(([k,label,color])=>{
      const share=m.ai[k]/total;
      const part=el('span',{className:`split-part${k==='pending'?' rest':''}`,title:`${label} ${m.ai[k]} 條（${pct(share)}）`,tabIndex:0});
      part.style.setProperty('--c',color);part.style.flex=`${m.ai[k]} 1 0`;
      if(share>=.12)part.textContent=pct(share);
      return part;
    }));
  const legend=el('ul',{className:'legend'},...AI_PARTS.map(([,label,color])=>{const s=el('span',{className:'swatch'});s.style.setProperty('--c',color);return el('li',{},s,label)}));
  const table=el('table',{className:'data-table'},el('thead',{},el('tr',{},el('th',{textContent:'結果'}),el('th',{textContent:'條數'}),el('th',{textContent:'比例'}))),
    el('tbody',{},...AI_PARTS.map(([k,label])=>el('tr',{},el('td',{textContent:label}),el('td',{textContent:String(m.ai[k])}),el('td',{textContent:pct(m.ai[k]/total)})))));
  const since=m.editedSince?new Date(m.editedSince):null;
  $('ai').replaceChildren(bar,legend,table,
    el('p',{className:'viz-foot',textContent:`「修改後採用」自 ${since?`${since.getFullYear()}/${since.getMonth()+1}/${since.getDate()}`:'本版本'} 起統計；更早的條目都算在直接採用。`}));
}

// --- Weekly grouped bars: one y-axis (counts), 4px rounded tops on the baseline, 2px gap between the pair. ---
// An even top under 10 (so the middle line is a whole count), else the next round number.
function niceMax(n){if(n<=4)return 4;if(n<10)return Math.ceil(n/2)*2;const step=Math.pow(10,Math.floor(Math.log10(n)));return Math.ceil(n/step)*step}
function renderWeekly(m){
  const rows=m.weekly,max=niceMax(Math.max(...rows.flatMap(r=>[r.created,r.done]),0));
  const box=$('weekly'),tableMode=$('weeklyTable').getAttribute('aria-pressed')==='true';
  const legend=el('ul',{className:'legend'},...[['新增','var(--series-1)'],['完成','var(--series-2)']].map(([l,c])=>{const s=el('span',{className:'swatch'});s.style.setProperty('--c',c);return el('li',{},s,l)}));
  const table=el('div',{className:'table-wrap'},el('table',{className:'data-table'},
    el('thead',{},el('tr',{},el('th',{textContent:'週（週一）'}),el('th',{textContent:'新增'}),el('th',{textContent:'完成'}))),
    el('tbody',{},...rows.map(r=>el('tr',{},el('td',{textContent:r.week.replaceAll('-','/')}),el('td',{textContent:String(r.created)}),el('td',{textContent:String(r.done)}))))));
  if(tableMode){box.replaceChildren(legend,table);return}
  // Drawn at the container's own width, so the axis text stays 11px on a phone.
  const W=Math.max(300,Math.round(box.clientWidth||640)),H=220,left=30,right=8,top=10,bottom=26,plotW=W-left-right,plotH=H-top-bottom,slot=plotW/rows.length;
  const barW=Math.min(18,(slot-10)/2),y=v=>top+plotH-v/max*plotH;
  const bar=(x,v,cls)=>{if(!v)return null;const h=v/max*plotH,r=Math.min(4,h);
    return svg('path',{class:cls,d:`M${x},${top+plotH}V${top+plotH-h+r}q0,-${r} ${r},-${r}h${barW-2*r}q${r},0 ${r},${r}V${top+plotH}Z`})};
  const ticks=[0,max/2,max];
  const chart=svg('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`最近 12 週每週新增與完成的待辦件數，最多 ${max} 件；表格可看每週數字`},
    ...ticks.map(t=>svg('line',{class:'grid-line',x1:left,x2:W-right,y1:y(t),y2:y(t)})),
    ...ticks.map(t=>svg('text',{class:'axis-label',x:left-6,y:y(t)+4,'text-anchor':'end'},String(t))),
    ...rows.flatMap((r,i)=>{const x0=left+i*slot+(slot-2*barW-2)/2;return [bar(x0,r.created,'bar-1'),bar(x0+barW+2,r.done,'bar-2')]}),
    ...rows.map((r,i)=>i%2===rows.length%2?null:svg('text',{class:'axis-label',x:left+i*slot+slot/2,y:H-8,'text-anchor':'middle'},md(r.week))),
    ...rows.map((r,i)=>{
      const hit=svg('rect',{class:'hit',x:left+i*slot,y:top,width:slot,height:plotH,tabindex:0,'aria-label':`${md(r.week)} 那週：新增 ${r.created}、完成 ${r.done}`});
      hit.addEventListener('pointerenter',()=>tip(i));hit.addEventListener('focus',()=>tip(i));
      hit.addEventListener('pointerleave',hide);hit.addEventListener('blur',hide);
      return hit;
    }));
  const tipBox=el('div',{className:'viz-tip',hidden:true});
  function tip(i){
    const r=rows[i],key=c=>{const s=el('span',{className:'swatch'});s.style.setProperty('--c',c);return s};
    tipBox.replaceChildren(el('b',{textContent:`${r.week.replaceAll('-','/')} 那週`}),el('span',{},key('var(--series-1)'),`新增 ${r.created} 件`),el('span',{},key('var(--series-2)'),`完成 ${r.done} 件`));
    tipBox.hidden=false;
    const scale=chart.getBoundingClientRect().width/W,x=(left+(i+.5)*slot)*scale;
    tipBox.style.left=`${Math.min(Math.max(0,x-70),chart.getBoundingClientRect().width-150)}px`;tipBox.style.top='0px';
  }
  function hide(){tipBox.hidden=true}
  box.replaceChildren(chart,tipBox,legend);
}

// --- Transcript table ---
function renderTranscript(m){
  if(!m.transcript.length){$('transcript').replaceChildren(el('p',{className:'viz-empty',textContent:'期間內的會議沒有逐字稿段落。'}));return}
  $('transcript').replaceChildren(el('div',{className:'table-wrap'},el('table',{className:'data-table'},
    el('thead',{},el('tr',{},...['辨識引擎','語言','會議','段落','修改過的段落','每百字修改字數'].map(t=>el('th',{textContent:t})))),
    el('tbody',{},...m.transcript.map(t=>el('tr',{},el('td',{textContent:ENGINES[t.engine]||t.engine}),el('td',{textContent:LANGUAGES[t.language]||t.language}),
      el('td',{textContent:String(t.meetings)}),el('td',{textContent:String(t.segments)}),
      el('td',{textContent:`${t.editedSegments}（${pct(t.segments?t.editedSegments/t.segments:null)}）`}),
      el('td',{textContent:t.per100==null?'—':String(t.per100)})))))));
}

let data=null;
function render(){
  const [from,to]=[data.from,data.to].map(d=>d.replaceAll('-','/'));
  $('range').textContent=`${from} – ${to}`;
  renderTiles(data);renderAi(data);renderWeekly(data);renderTranscript(data);
}
async function load(){
  const ticket=++latest,query=new URLSearchParams();
  for(const k of ['team','days'])if(params.get(k))query.set(k,params.get(k));
  const response=await fetch(`/api/metrics?${query}`);
  const result=await response.json().catch(()=>null);
  if(ticket!==latest)return;
  if(response.status===404&&params.get('team')){setParam('team','');$('team').value='';notice('找不到這個團隊，已改為顯示全部團隊');return load()}
  if(!response.ok||!result?.actions)throw new Error(typeof result?.detail==='string'?result.detail:'無法載入指標');
  data=result;
  if(!teamsLoaded){teamsLoaded=true;$('team').append(...data.teams.map(t=>el('option',{value:t.id,textContent:t.name})));$('team').value=params.get('team')||''}
  render();
}
const reload=()=>load().catch(error=>notice(error.message));
$('days').value=['30','90','365'].includes(params.get('days'))?params.get('days'):'30';
$('team').onchange=()=>{notice('');setParam('team',$('team').value);reload()};
$('days').onchange=()=>{setParam('days',$('days').value==='30'?'':$('days').value);reload()};
$('weeklyTable').onclick=()=>{const on=$('weeklyTable').getAttribute('aria-pressed')!=='true';$('weeklyTable').setAttribute('aria-pressed',String(on));$('weeklyTable').textContent=on?'圖表':'表格';if(data)renderWeekly(data)};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
let resizing;
addEventListener('resize',()=>{clearTimeout(resizing);resizing=setTimeout(()=>{if(data)renderWeekly(data)},150)});
window.accountReady.then(reload);
