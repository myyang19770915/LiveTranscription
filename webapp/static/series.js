/* Meeting page: the series of the next meeting, the series' unfinished action items, and in-meeting progress
   suggestions (meeting-series). app.js calls MeetingSeries.started/saved/ended/lock around the meeting. */
(function(){
  const $=id=>document.getElementById(id);
  function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
  const NEW='__new',MIN_SEGMENTS=3,MIN_INTERVAL=45000;
  const STATUS={todo:'未開始',doing:'進行中',done:'已完成',cancelled:'已取消'};
  const SUGGEST={doing:'可能已開始',done:'可能已完成',cancelled:'可能取消'};
  const pad=n=>String(n).padStart(2,'0');
  const clock=ms=>{const s=Math.floor(ms/1000);return `${pad(Math.floor(s/60))}:${pad(s%60)}`};
  const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
  let teamId='',items=[],suggestions=[],minutesModel=false,locked=false,listTicket=0;
  // The meeting being checked: segments 1..count are saved; segments 1..after were already sent.
  let check={meeting:'',after:0,count:0,lastAt:0,busy:false,final:false};

  const seriesId=()=>{const v=$('series').value;return v&&v!==NEW?Number(v):null};
  const detecting=()=>!!seriesId()&&minutesModel&&$('detect').checked;

  async function json(url,options){
    const response=await fetch(url,options);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(typeof data.detail==='string'?data.detail:'操作失敗'),{status:response.status});
    return data;
  }
  const post=(url,body)=>json(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});

  // --- Series menu ---
  async function loadSeries(team){
    teamId=team;
    const list=team?await json(`/api/teams/${team}/series`).catch(()=>[]):[];
    if(team!==teamId)return;
    $('series').replaceChildren(el('option',{value:'',textContent:'不屬於系列'}),
      ...list.map(s=>el('option',{value:s.id,textContent:s.name})),el('option',{value:NEW,textContent:'＋ 新增系列…'}));
    const saved=store.get(`series:${team}`)||'';
    $('series').value=list.some(s=>String(s.id)===saved)?saved:'';
    $('seriesRow').hidden=!team;
    showNewForm(false);loadItems();
  }
  function showNewForm(on){$('newSeries').hidden=!on;if(on){$('seriesName').value='';$('seriesName').focus()}}
  async function createSeries(){
    const name=$('seriesName').value.trim();
    if(!name){$('seriesName').focus();return}
    try{
      const created=await post(`/api/teams/${teamId}/series`,{name});
      if(![...$('series').options].some(o=>o.value===String(created.id)))
        $('series').insertBefore(el('option',{value:created.id,textContent:created.name}),$('series').lastElementChild);
      $('series').value=String(created.id);store.set(`series:${teamId}`,String(created.id));
      showNewForm(false);loadItems();
    }catch(error){window.toast?.(error.message,4000)}
  }

  // --- Unfinished items and suggestions ---
  async function loadItems(){
    const id=seriesId(),ticket=++listTicket;
    $('seriesPanel').hidden=!id;
    if(!id){items=[];return}
    $('seriesTitle').textContent=$('series').selectedOptions[0]?.textContent||'';
    $('detectRow').hidden=!minutesModel;
    try{
      const exclude=check.meeting?`?exclude=${check.meeting}`:'';
      const list=await json(`/api/series/${id}/actions${exclude}`);
      if(ticket===listTicket){items=list;render()}
    }catch(error){if(ticket===listTicket){items=[];$('seriesItems').replaceChildren(el('li',{className:'series-empty',textContent:error.message}))}}
  }
  function due(item){
    if(item.overdueDays>0)return el('span',{className:'series-overdue',textContent:`逾期 ${item.overdueDays} 天`});
    return item.dueDate?el('span',{textContent:`到期 ${item.dueDate.slice(5).replace('-','/')}`}):null;
  }
  function suggestionCard(s){
    const decide=async action=>{
      try{
        const {suggestion,item}=await post(`/api/meetings/${check.meeting}/progress/${s.id}/${action}`);
        // Applying one settles the item's other suggestions too (the server dismisses them).
        suggestions=suggestions.filter(x=>x.id!==suggestion.id&&!(action==='accept'&&x.itemId===s.itemId));
        if(item){const i=items.find(x=>x.id===item.id);if(i)Object.assign(i,{status:item.status,overdueDays:item.overdueDays})}
        render();
      }catch(error){
        window.toast?.(error.message,4000);
        if(error.status===409){suggestions=suggestions.filter(x=>x.id!==s.id);render()}   // handled elsewhere; other errors keep it for a retry
      }
    };
    return el('div',{className:'series-suggestion'},
      el('p',{className:'series-suggestion-head'},el('b',{textContent:SUGGEST[s.toStatus]}),s.note?`：${s.note}`:null),
      ...s.evidence.map(e=>el('p',{className:'series-evidence'},el('span',{textContent:clock(e.startMs)}),` 「${e.source}」`)),
      el('div',{className:'series-suggestion-actions'},
        el('button',{type:'button',className:'series-apply',textContent:`套用：${STATUS[s.toStatus]}`,onclick:()=>decide('accept')}),
        el('button',{type:'button',className:'series-dismiss',textContent:'略過',onclick:()=>decide('dismiss')})));
  }
  function render(){
    const open=items.filter(i=>i.status==='todo'||i.status==='doing');
    $('seriesCount').textContent=String(open.length);
    $('seriesItems').replaceChildren(...(items.length?items.map(item=>el('li',{className:`series-item status-${item.status}`,id:`series-item-${item.id}`},
      el('div',{className:'series-item-main'},
        el('span',{className:'series-item-content',textContent:item.content}),
        el('span',{className:'series-item-meta'},el('span',{textContent:item.owner?item.ownerName:'未指派'}),due(item),
          el('span',{className:'series-status',textContent:STATUS[item.status]}))),
      ...suggestions.filter(s=>s.itemId===item.id).map(suggestionCard)))
      :[el('li',{className:'series-empty',textContent:'這個系列沒有未完成的待辦'})]));
  }

  // --- Detection during the meeting ---
  async function runCheck(){
    if(!check.meeting||check.busy||!detecting()||check.count<=check.after)return;
    check.busy=true;check.lastAt=Date.now();
    const meeting=check.meeting;
    try{
      const result=await post(`/api/meetings/${meeting}/progress/check`,{after:check.after});
      if(meeting!==check.meeting)return;
      check.after=Math.max(check.after,result.checkedThrough);
      suggestions=result.suggestions;
      $('detectError').hidden=!result.error;$('detectError').textContent=result.error||'';
      render();
    }catch(error){$('detectError').textContent=error.message;$('detectError').hidden=false}
    finally{check.busy=false;if(check.final&&check.count>check.after&&!$('detectError').textContent)runCheck()}
  }
  function maybeCheck(force){
    if(!detecting()||check.busy)return;
    const fresh=check.count-check.after;
    if(fresh<=0||(!force&&(fresh<MIN_SEGMENTS||Date.now()-check.lastAt<MIN_INTERVAL)))return;
    runCheck();
  }

  window.MeetingSeries={
    seriesId,
    lock(active){locked=active;$('series').disabled=active;$('seriesName').disabled=active},
    started(meetingId){check={meeting:meetingId,after:0,count:0,lastAt:Date.now(),busy:false,final:false};suggestions=[];$('detectError').hidden=true;loadItems()},
    saved(meetingId,count){if(meetingId!==check.meeting)return;check.count=count;maybeCheck(check.final)},
    // The last segments are saved shortly after the meeting stops; check them once more then.
    ended(meetingId){if(meetingId!==check.meeting)return;check.final=true;setTimeout(()=>maybeCheck(true),2500)},
  };

  $('series').onchange=()=>{
    if($('series').value===NEW){showNewForm(true);return}
    showNewForm(false);store.set(`series:${teamId}`,$('series').value);loadItems();
  };
  $('seriesCreate').onclick=createSeries;
  $('seriesName').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();createSeries()}if(event.key==='Escape'){$('series').value=store.get(`series:${teamId}`)||'';showNewForm(false)}};
  $('seriesCancel').onclick=()=>{$('series').value=store.get(`series:${teamId}`)||'';showNewForm(false);loadItems()};
  $('detect').checked=store.get('progressDetect')==='1';
  $('detect').onchange=()=>{store.set('progressDetect',$('detect').checked?'1':'0');if($('detect').checked)maybeCheck(true)};
  $('team').addEventListener('change',()=>loadSeries($('team').value));
  Promise.all([window.accountSoon,(window.appConfig||fetch('/api/config').then(r=>r.ok?r.json():null).catch(()=>null)).then(c=>c||{})]).then(([,config])=>{
    minutesModel=!!config.minutes;
    // app.js fills the team menu from the same account answer; read it after that.
    setTimeout(()=>loadSeries($('team').value),0);
  });
})();
