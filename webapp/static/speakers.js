// Speakers on the review page (speaker-diarization): the meeting's diarization status, its speakers with the names
// people gave them, and a speaker menu on each segment. Uses review.js's globals (meetingId, meeting, segments, call,
// notice, el, $, replace, render); review.js calls Speakers.load() once the meeting is loaded and Speakers.chip() per row.
const Speakers=(()=>{
  let state={configured:false,status:'none',message:'',speakers:[],members:[]},timer=null,editing=null;
  const COLOURS=8;
  const colour=label=>label&&label<=COLOURS?`var(--spk-${label})`:'var(--faint)';
  const busy=()=>state.status==='queued'||state.status==='running';
  const url=path=>`/api/meetings/${meetingId}/${path}`;

  async function fetchState(){state=await call('GET',url('speakers'))}
  async function load(){
    try{await fetchState()}catch(error){notice(error.message);return}
    panel();if(state.speakers.length)render();poll();
  }
  // While queued or running, check every 10 s; when it finishes, reload the segments with their speakers.
  function poll(){clearTimeout(timer);if(busy())timer=setTimeout(refresh,10000)}
  async function refresh(){
    const before=state.status;
    try{await fetchState()}catch{poll();return}
    if(before!==state.status&&state.status==='done')segments=(await call('GET',`/api/meetings/${meetingId}`)).segments;
    panel();render();poll();
  }

  function statusText(){
    const n=state.speakers.length;
    if(!state.configured&&!busy())return n?'說話者辨識未設定（以下是先前的結果）。':'說話者辨識未設定。';
    return {none:meeting.hasRecording?'尚未辨識說話者。':'這場會議沒有錄音，無法辨識說話者。',
      queued:'已排入說話者辨識，等待前一場完成…',
      running:'正在辨識說話者，約需會議長度 0.4 到 1 倍的時間；可以先離開這頁。',
      done:`已辨識出 ${n} 位說話者。點名字可以指定為團隊成員或自填名字；段落上的名字可以個別修改。`,
      failed:state.message||'說話者辨識失敗。'}[state.status];
  }
  function panel(){
    const box=$('speakers');
    box.hidden=!state.configured&&!state.speakers.length&&state.status==='none';
    if(box.hidden)return;
    const canRun=state.configured&&meeting.hasRecording&&!busy();
    box.replaceChildren(
      el('div',{className:'speakers-head'},el('b',{textContent:'說話者'}),
        el('span',{className:`speakers-status${state.status==='failed'?' warn':''}`,role:'status',textContent:statusText()}),
        el('span',{className:'spacer'}),
        canRun?el('button',{type:'button',className:'secondary-button compact',textContent:state.status==='none'?'辨識說話者':'重新辨識',onclick:run}):null),
      state.speakers.length?el('div',{className:'speakers-list'},...state.speakers.map(s=>editing===s.label?editor(s):
        el('button',{type:'button',className:'spk-name',title:'修改名字',style:`--spk:${colour(s.label)}`,onclick:()=>{editing=s.label;panel()}},
          el('i'),el('span',{textContent:s.shown}),el('small',{textContent:`${s.segments} 段`})))):null);
  }
  async function run(){
    if(state.speakers.length&&!confirm('重新辨識會清除目前的說話者名字與手動指定，確定要重新辨識嗎？'))return;
    try{await call('POST',url('speakers/run'));await refresh()}catch(error){notice(error.message)}
  }
  // A speaker is a team member (shown with their display name) or a free-text name.
  function editor(speaker){
    const who=el('select',{className:'input compact',ariaLabel:'團隊成員'},el('option',{value:'',textContent:'自填名字'}),
      ...state.members.map(m=>el('option',{value:m.username,textContent:m.displayName})));
    who.value=state.members.some(m=>m.username===speaker.username)?speaker.username:'';
    const name=el('input',{className:'input compact',maxLength:40,value:speaker.name,placeholder:`說話者 ${speaker.label}`,ariaLabel:'名字'});
    const sync=()=>{name.hidden=!!who.value};who.onchange=sync;sync();
    const save=el('button',{type:'submit',className:'primary-button compact',textContent:'儲存'});
    queueMicrotask(()=>(who.value?who:name).focus());
    return el('form',{className:'spk-edit',style:`--spk:${colour(speaker.label)}`,onsubmit:async event=>{
      event.preventDefault();save.disabled=true;
      try{
        const updated=await call('PUT',url(`speakers/${speaker.label}`),{username:who.value||null,name:who.value?'':name.value});
        state.speakers=state.speakers.map(s=>s.label===updated.label?updated:s);editing=null;panel();render();
      }catch(error){notice(error.message);save.disabled=false}
    }},el('span',{className:'spk'},el('i')),who,name,save,
      el('button',{type:'button',className:'text-button',textContent:'取消',onclick:()=>{editing=null;panel()}}));
  }

  // The segment's speaker menu: the meeting's speakers, 未指定, and a new speaker.
  function chip(segment){
    if(!state.speakers.length)return null;
    const label=segment.speaker??null;
    const menu=el('select',{className:'spk-select',ariaLabel:`第 ${segment.seq} 段的說話者`,title:'修改這段的說話者',
      onchange:()=>change(segment.seq,menu.value)},
      ...state.speakers.map(s=>el('option',{value:String(s.label),textContent:s.shown})),
      el('option',{value:'',textContent:'未指定說話者'}),el('option',{value:'new',textContent:'＋ 新增說話者'}));
    menu.value=label==null?'':String(label);
    return el('span',{className:'spk',style:`--spk:${colour(label)}`,onclick:event=>event.stopPropagation()},el('i',{ariaHidden:'true'}),menu);
  }
  async function change(seq,value){
    try{
      let label=value===''?null:Number(value);
      if(value==='new'){const added=await call('POST',url('speakers'));state.speakers.push(added);label=added.label}
      replace(await call('PUT',url(`segments/${seq}/speaker`),{label}));
      await fetchState();panel();
    }catch(error){notice(error.message);render()}
  }
  return {load,chip};
})();
