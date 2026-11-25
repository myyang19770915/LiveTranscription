// Usage management page (usage-admin): what the two paid services were used for and what that is estimated to cost,
// from /api/admin/usage, and the budget of each service (PUT /api/admin/usage/budgets). Amounts are seconds x the
// current price: estimates, not the bill. Reaching a budget only shows a warning here.
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
const SVG='http://www.w3.org/2000/svg';
function svg(tag,attrs={},...children){const node=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);node.append(...children.filter(Boolean));return node}
const NAMES={mai:'雲端辨識',interpret:'即時口譯'};
const COLOURS={mai:'var(--series-1)',interpret:'var(--series-2)'};
// A purpose in plain words where it is known; others are shown as recorded.
const PURPOSES={mai:{live:'即時辨識',quality:'精準模式',bench:'評測',lab:'測試'},interpret:{live:'即時口譯',bench:'評測',lab:'測試'}};
const STATES={ok:'正常',near:'接近上限',over:'已達上限'};
const ICONS={ok:'<path d="M5 12.5 10 17.5 19 7"/>',near:'<path d="M12 4 21 19H3Z"/><path d="M12 10v4m0 3v.01"/>',over:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5m0 3.5v.01"/>'};
const money=usd=>usd.toFixed(2);
const cents=usd=>Number(usd.toFixed(2));   // sums are made of the amounts shown, so rows add up
const hours=seconds=>(seconds/3600).toFixed(2);
const slash=iso=>iso.replaceAll('-','/');
const md=iso=>{const [,m,d]=iso.split('-').map(Number);return `${m}/${d}`};
const icon=state=>{const s=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});s.innerHTML=ICONS[state];return s};
const swatch=colour=>{const s=el('span',{className:'swatch'});s.style.setProperty('--c',colour);return s};
let data=null;
const service=key=>data.services.find(s=>s.key===key);
const usdOf=(key,seconds)=>seconds/3600*service(key).usdPerHour;

// --- Warnings: one line per service near or over its budget ---
function renderWarnings(){
  $('warnings').replaceChildren(...data.services.filter(s=>s.state!=='ok').map(s=>el('p',{className:`alert usage-warning ${s.state}`,role:'status'},icon(s.state),
    s.state==='over'?`${NAMES[s.key]}已達到上限：累計約 ${money(s.total.usd)} 美元，上限 ${money(s.budgetUsd)} 美元。服務仍可使用，要不要繼續由你決定。`
      :`${NAMES[s.key]}接近上限：累計約 ${money(s.total.usd)} 美元，已達上限 ${money(s.budgetUsd)} 美元的八成。`)));
}

// --- Figures ---
function tile(label,usd,note){
  return el('article',{className:'card tile'},el('p',{className:'tile-label',textContent:label}),
    el('p',{className:'tile-value'},money(usd),el('small',{textContent:'美元'})),el('p',{className:'tile-note',textContent:note}));
}
function renderTiles(){
  const [mai,interpret]=data.services;
  // Sums of the figures shown, so the tiles add up.
  $('tiles').replaceChildren(
    tile('本月合計',mai.month.usd+interpret.month.usd,`共 ${hours(mai.month.seconds+interpret.month.seconds)} 小時；上月 ${money(mai.previousMonth.usd+interpret.previousMonth.usd)} 美元`),
    tile('雲端辨識 本月',mai.month.usd,`${hours(mai.month.seconds)} 小時，每小時 ${mai.usdPerHour} 美元`),
    tile('即時口譯 本月',interpret.month.usd,`${hours(interpret.month.seconds)} 小時，每小時 ${interpret.usdPerHour} 美元`),
    tile('累計合計',mai.total.usd+interpret.total.usd,`共 ${hours(mai.total.seconds+interpret.total.seconds)} 小時；雲端辨識 ${money(mai.total.usd)} 美元，即時口譯 ${money(interpret.total.usd)} 美元`));
}

// --- Budget cards ---
function budgetCard(s){
  const name=NAMES[s.key],titleId=`budget-${s.key}`,has=s.budgetUsd!=null;
  const share=has?Math.round(s.total.usd/s.budgetUsd*100):0;
  const text=has?`${money(s.total.usd)} / ${money(s.budgetUsd)} 美元（${share}%）`:`${money(s.total.usd)} 美元，未設上限`;
  const figure=el('p',{className:'budget-figure'},el('b',{textContent:money(s.total.usd)}),has?` / ${money(s.budgetUsd)} 美元（${share}%）`:' 美元 · 未設上限');
  const fill=el('span',{className:'meter-fill'});fill.style.width=`${Math.min(100,share)}%`;
  const meter=has?el('div',{className:`meter ${s.state}`},fill,el('span',{className:'meter-mark',title:'上限的八成'})):null;
  if(meter)for(const [name_,value] of Object.entries({role:'meter','aria-label':`${name}累計金額對上限`,'aria-valuemin':0,'aria-valuemax':s.budgetUsd,
    'aria-valuenow':Math.min(s.total.usd,s.budgetUsd),'aria-valuetext':text}))meter.setAttribute(name_,value);   // attributes: every browser exposes them
  const input=el('input',{className:'input compact',type:'number',inputMode:'decimal',min:'0.01',max:'1000000',step:'0.01',placeholder:'不設上限',value:has?String(s.budgetUsd):''});
  const save=el('button',{type:'submit',className:'secondary-button compact',textContent:'儲存'});
  const note=el('p',{className:'budget-note'});note.setAttribute('aria-live','polite');
  const form=el('form',{className:'budget-form',noValidate:true},el('label',{className:'budget-field'},'累計上限（美元），留空表示不設上限',input),save);
  const fail=message=>{note.className='budget-note failed';note.textContent=message};   // the field keeps what was typed
  form.onsubmit=async event=>{
    event.preventDefault();
    const typed=input.value.trim(),amount=Number(typed);
    // Text that is not a number reads as '' in a number field: it must not be taken for "no budget".
    if(input.validity.badInput||(typed!==''&&!(amount>=.01&&amount<=1000000))){fail('上限要是 0.01 到 1000000 之間的金額，留空表示不設上限');return}
    // The other service keeps the budget it has: only this card's field is saved.
    const budgets=Object.fromEntries(data.services.map(other=>[other.key,other.budgetUsd]));
    budgets[s.key]=typed===''?null:amount;
    const buttons=[...document.querySelectorAll('.budget-form button')];   // one save at a time: a second one would send figures from before the first
    note.className='budget-note';note.textContent='';buttons.forEach(button=>{button.disabled=true});
    try{
      const response=await fetch('/api/admin/usage/budgets',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(budgets)});
      if(!response.ok){const detail=(await response.json().catch(()=>({}))).detail;throw new Error(typeof detail==='string'?detail:'儲存失敗，請再試一次')}
    }catch(error){fail(error.message);buttons.forEach(button=>{button.disabled=false});return}
    // Saved. The cards are drawn again from the new figures; what was typed in the other card and not saved stays there.
    const unsaved=Object.fromEntries([...document.querySelectorAll('.budget')].map(card=>[card.dataset.service,card.querySelector('input').value]));
    await reload();
    for(const card of document.querySelectorAll('.budget')){
      if(card.dataset.service!==s.key){card.querySelector('input').value=unsaved[card.dataset.service]??'';continue}
      card.querySelector('.budget-note').textContent=budgets[s.key]==null?'已儲存：不設上限。':`已儲存：上限 ${money(budgets[s.key])} 美元。`;
      card.querySelector('button').focus();
    }
  };
  const card=el('article',{className:'card budget'},
    el('div',{className:'budget-head'},el('h2',{id:titleId,textContent:name}),el('span',{className:`state ${s.state}`},icon(s.state),STATES[s.state])),
    figure,meter,el('p',{className:'budget-foot',textContent:`累計 ${hours(s.total.seconds)} 小時，每小時 ${s.usdPerHour} 美元`}),form,note);
  card.dataset.service=s.key;
  return card;
}
function renderBudgets(){$('budgets').replaceChildren(...data.services.map(budgetCard))}

// --- Tables: every wide table scrolls inside its own card and can be scrolled from the keyboard ---
function table(head,rows,foot){
  return el('div',{className:'table-wrap',tabIndex:0,role:'region'},el('table',{className:'data-table'},
    el('thead',{},el('tr',{},...head.map(text=>el('th',{scope:'col',textContent:text})))),
    el('tbody',{},...rows.map(cells=>el('tr',{},...cells.map(text=>el('td',{textContent:text}))))),
    foot?el('tfoot',{},el('tr',{},...foot.map(text=>el('td',{textContent:text})))):null));
}
function labelled(wrap,id){wrap.setAttribute('aria-labelledby',id);return wrap}
const empty=text=>el('p',{className:'viz-empty',textContent:text});

// --- Daily cost: one stacked bar per day on one USD axis; 4px rounded top, a 2px gap between the two services ---
function niceMax(n){if(!(n>0))return .1;const step=Math.pow(10,Math.floor(Math.log10(n)));return Math.max(.1,Math.ceil(n/step-1e-9)*step)}
const tick=n=>String(Number(n.toFixed(2)));
function renderDaily(){
  const rows=data.daily.map(d=>({day:d.day,mai:usdOf('mai',d.mai),interpret:usdOf('interpret',d.interpret),maiSeconds:d.mai,interpretSeconds:d.interpret}));
  const box=$('daily'),used=rows.filter(r=>r.maiSeconds||r.interpretSeconds);
  if(!used.length){box.replaceChildren(empty('近 30 天沒有用量'));return}
  const legend=el('ul',{className:'legend'},...['mai','interpret'].map(key=>el('li',{},swatch(COLOURS[key]),NAMES[key])));
  if($('dailyTable').getAttribute('aria-pressed')==='true'){
    box.replaceChildren(labelled(table(['日期','雲端辨識（小時）','即時口譯（小時）','金額（美元）'],
      used.toReversed().map(r=>[slash(r.day),hours(r.maiSeconds),hours(r.interpretSeconds),money(cents(r.mai)+cents(r.interpret))])),'dailyTitle'));
    return;
  }
  const max=niceMax(Math.max(...rows.map(r=>r.mai+r.interpret)));
  // Drawn at the container's own width, so the axis text stays 11px on a phone.
  const W=Math.max(300,Math.round(box.clientWidth||640)),H=220,left=38,right=8,top=10,bottom=26,plotW=W-left-right,plotH=H-top-bottom,slot=plotW/rows.length;
  const barW=Math.max(4,Math.min(18,slot-4)),base=top+plotH,y=v=>base-v/max*plotH,GAP=2;
  // A segment from `from` px up for `h` px; only the top segment of a bar has round corners.
  const segment=(x,from,h,round,cls)=>{const r=round?Math.min(4,h,barW/2):0;
    return svg('path',{class:cls,d:`M${x},${from}V${from-h+r}q0,-${r} ${r},-${r}h${barW-2*r}q${r},0 ${r},${r}V${from}Z`})};
  const bars=rows.flatMap((r,i)=>{
    const x=left+i*slot+(slot-barW)/2,lower=r.mai?Math.max(2,r.mai/max*plotH):0,upper=r.interpret?Math.max(2,r.interpret/max*plotH):0;
    return [lower?segment(x,base,lower,!upper,'bar-1'):null,upper?segment(x,base-lower-(lower?GAP:0),upper,true,'bar-2'):null];
  });
  const ticks=[0,max/2,max];
  const total=rows.reduce((n,r)=>n+r.mai+r.interpret,0);
  const hits=rows.map((r,i)=>svg('rect',{class:'hit',x:left+i*slot,y:top,width:slot,height:plotH,tabindex:-1,role:'img',
    'aria-label':`${md(r.day)}：雲端辨識 ${money(r.mai)} 美元、即時口譯 ${money(r.interpret)} 美元`}));
  const chart=svg('svg',{viewBox:`0 0 ${W} ${H}`,role:'group','aria-label':`近 30 天每日估算金額，合計約 ${money(total)} 美元；用左右方向鍵看每一天，「表格」可看數字`},
    ...ticks.map(t=>svg('line',{class:'grid-line',x1:left,x2:W-right,y1:y(t),y2:y(t)})),
    ...ticks.map(t=>svg('text',{class:'axis-label',x:left-6,y:y(t)+4,'text-anchor':'end'},tick(t))),
    ...bars,
    ...rows.map((r,i)=>(rows.length-1-i)%5?null:svg('text',{class:'axis-label',x:left+i*slot+slot/2,y:H-8,'text-anchor':'middle'},md(r.day))),
    ...hits);
  const tipBox=el('div',{className:'viz-tip',hidden:true});
  function tip(i){
    const r=rows[i];
    tipBox.replaceChildren(el('b',{textContent:slash(r.day)}),
      el('span',{},swatch(COLOURS.mai),`雲端辨識 ${money(r.mai)} 美元（${hours(r.maiSeconds)} 小時）`),
      el('span',{},swatch(COLOURS.interpret),`即時口譯 ${money(r.interpret)} 美元（${hours(r.interpretSeconds)} 小時）`));
    tipBox.hidden=false;
    const width=chart.getBoundingClientRect().width,x=(left+(i+.5)*slot)*width/W;
    tipBox.style.left=`${Math.max(0,Math.min(x-110,width-230))}px`;tipBox.style.top='0px';
  }
  const hide=()=>{tipBox.hidden=true};
  // One tab stop for the chart; the arrow keys move between days (the last day with usage is where it starts).
  let current=rows.findLastIndex(r=>r.maiSeconds||r.interpretSeconds);
  const move=to=>{hits[current].setAttribute('tabindex',-1);current=Math.max(0,Math.min(rows.length-1,to));hits[current].setAttribute('tabindex',0);hits[current].focus()};
  hits[current].setAttribute('tabindex',0);
  hits.forEach((hit,i)=>{
    hit.addEventListener('pointerenter',()=>tip(i));hit.addEventListener('pointerleave',hide);
    hit.addEventListener('focus',()=>tip(i));hit.addEventListener('blur',hide);
    hit.addEventListener('keydown',event=>{
      const to={ArrowLeft:i-1,ArrowRight:i+1,Home:0,End:rows.length-1}[event.key];
      if(to===undefined)return;
      event.preventDefault();move(to);
    });
  });
  box.replaceChildren(chart,tipBox,legend);
}

// --- Months, purposes, users ---
function renderMonthly(){
  const rows=data.months.toReversed().map(m=>{const a=usdOf('mai',m.mai),b=usdOf('interpret',m.interpret);
    return [m.month.replace('-','/'),hours(m.mai),money(a),hours(m.interpret),money(b),money(cents(a)+cents(b))]});
  $('monthly').replaceChildren(labelled(table(['月份','雲端辨識（小時）','雲端辨識（美元）','即時口譯（小時）','即時口譯（美元）','合計（美元）'],rows),'monthlyTitle'));
}
function renderPurposes(){
  const rows=data.services.flatMap(s=>s.byPurpose.map(p=>[NAMES[s.key],(Object.hasOwn(PURPOSES[s.key],p.purpose)?PURPOSES[s.key][p.purpose]:p.purpose),hours(p.monthSeconds),hours(p.seconds),money(usdOf(s.key,p.seconds))]));
  $('purposes').className='names-2';$('purposes').replaceChildren(rows.length?labelled(table(['服務','用途','本月（小時）','累計（小時）','累計（美元）'],rows),'purposeTitle'):empty('還沒有用量。'));
}
function renderUsers(){
  const rows=service('interpret').byUser.map(u=>[u.username||'（未記名）',hours(u.monthSeconds),hours(u.seconds),money(usdOf('interpret',u.seconds))]);
  $('users').replaceChildren(rows.length?labelled(table(['使用者','本月（小時）','累計（小時）','累計（美元）'],rows),'usersTitle'):empty('還沒有人用過即時口譯。'));
}

function render(){
  $('asOf').textContent=`資料到 ${slash(data.today)}`;
  renderWarnings();renderTiles();renderBudgets();renderDaily();renderMonthly();renderPurposes();renderUsers();
}
async function load(){
  const response=await fetch('/api/admin/usage');
  if(response.status===401)return;   // signed out: account.js goes to the sign-in page
  const result=response.ok?await response.json().catch(()=>null):null;
  if(result?.services?.length!==2)throw new Error('用量暫時讀不到，請稍後再試。');
  data=result;
  $('loadError').hidden=true;$('content').hidden=false;
  render();
}
// Nothing is shown rather than zeros when the figures cannot be read.
const reload=()=>load().catch(error=>{data=null;$('content').hidden=true;$('warnings').replaceChildren();$('asOf').textContent='';$('loadError').textContent=error.message;$('loadError').hidden=false});
$('dailyTable').onclick=()=>{const on=$('dailyTable').getAttribute('aria-pressed')!=='true';$('dailyTable').setAttribute('aria-pressed',String(on));$('dailyTable').textContent=on?'圖表':'表格';if(data)renderDaily()};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
let resizing;
addEventListener('resize',()=>{clearTimeout(resizing);resizing=setTimeout(()=>{if(data&&!$('daily').contains(document.activeElement))renderDaily()},150)});
window.onPageShown(reload);
reload();
