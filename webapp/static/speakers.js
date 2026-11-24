// Speakers on the review page (speaker-diarization, speaker-timeline): the diarization status, a card per speaker
// (name and role), a lane per speaker with a bar for each turn, playback from any turn with the text following the
// audio, and a speaker menu on each segment. Uses review.js's globals (meetingId, meeting, segments, editing, call,
// notice, el, $, replace, render); review.js calls Speakers.load() once, Speakers.chip() per row, Speakers.stop()
// when it starts segment playback, and reads Speakers.speaking() to mark the segment at the play position.
const Speakers=(()=>{
  let state={configured:false,status:'none',message:'',speakers:[],members:[],turns:[],durationMs:0},timer=null,editing=null,selected=null;
  const COLOURS=8,CHUNK_MS=5*60*1000,SEGMENT_LEAD_MS=3000,TIMED_LEAD_MS=300;
  const colour=label=>label&&label<=COLOURS?`var(--spk-${label})`:'var(--faint)';
  const busy=()=>state.status==='queued'||state.status==='running';
  const url=path=>`/api/meetings/${meetingId}/${path}`;
  const clock=MeetingNav.clock;
  const byLabel=label=>state.speakers.find(s=>s.label===label);
  const pct=ms=>`${Math.min(100,Math.max(0,ms/(state.durationMs||1)*100))}%`;

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
    if(before!==state.status&&state.status==='done'){stop();segments=(await call('GET',`/api/meetings/${meetingId}`)).segments}
    panel();render();poll();
  }

  function statusText(){
    const n=state.speakers.length;
    if(!state.configured&&!busy())return n?'說話者辨識未設定（以下是先前的結果）。':'說話者辨識未設定。';
    return {none:meeting.hasRecording?'尚未辨識說話者。':'這場會議沒有錄音，無法辨識說話者。',
      queued:'已排入說話者辨識，等待前一場完成…',
      running:'正在辨識說話者，約需會議長度 0.4 到 1 倍的時間；可以先離開這頁。',
      done:'點卡片可以指定為團隊成員、自填名字或加上角色；點時間軸上的發言就從那裡播放。',
      failed:state.message||'說話者辨識失敗。'}[state.status];
  }
  function panel(){
    const box=$('speakers');
    box.hidden=!state.configured&&!state.speakers.length&&state.status==='none';
    if(box.hidden)return;
    const canRun=state.configured&&meeting.hasRecording&&!busy();
    const lanes=state.turns.length&&state.durationMs;
    box.replaceChildren(...[   // replaceChildren would turn a null into the text "null"
      el('div',{className:'speakers-head'},el('b',{textContent:lanes?'發言時間軸':'說話者'}),
        el('span',{className:'spacer'}),
        state.speakers.length?el('span',{className:'speakers-meta',textContent:`${lanes?`錄音 ${clock(state.durationMs)} · `:''}${state.speakers.length} 位說話者`}):null,
        canRun?el('button',{type:'button',className:'secondary-button compact',textContent:state.status==='none'?'辨識說話者':'重新辨識',onclick:run}):null),
      el('p',{className:`speakers-status${state.status==='failed'?' warn':''}`,role:'status',textContent:statusText()}),
      state.speakers.length?el('div',{className:'spk-cards'},...state.speakers.map(card)):null,
      editing!=null&&byLabel(editing)?editor(byLabel(editing)):null,
      lanes?el('div',{className:`spk-lanes${selected!=null?' has-selected':''}`,onkeydown:laneKeys},...state.speakers.map(lane)):null,
      lanes?nowPlaying():null].filter(Boolean));
    if(play.active)tick(true);
  }
  function card(s){
    const second=s.note||`${state.turns.filter(t=>t[2]===s.label).length} 次發言 · 共 ${clock(s.turnMs||0)}`;
    return el('button',{type:'button',className:`spk-card${selected===s.label?' selected':''}`,style:`--spk:${colour(s.label)}`,title:'選取並修改名字或角色',
      onclick:()=>{const same=selected===s.label&&editing===s.label;selected=same?null:s.label;editing=same?null:s.label;panel()}},
      el('i'),el('span',{},el('b',{textContent:s.shown}),el('small',{textContent:second})));
  }
  async function run(){
    if(state.speakers.length&&!confirm('重新辨識會清除目前的說話者名字、角色與手動指定，確定要重新辨識嗎？'))return;
    stop();
    try{await call('POST',url('speakers/run'));await refresh()}catch(error){notice(error.message)}
  }
  // A speaker is a team member (shown with their display name) or a free-text name, with an optional role.
  function editor(speaker){
    const who=el('select',{className:'input compact',ariaLabel:'團隊成員'},el('option',{value:'',textContent:'自填名字'}),
      ...state.members.map(m=>el('option',{value:m.username,textContent:m.displayName})));
    who.value=state.members.some(m=>m.username===speaker.username)?speaker.username:'';
    const name=el('input',{className:'input compact',maxLength:40,value:speaker.name,placeholder:`說話者 ${speaker.label}`,ariaLabel:'名字'});
    const note=el('input',{className:'input compact',maxLength:40,value:speaker.note||'',placeholder:'角色（例如 主持人）',ariaLabel:'角色'});
    const sync=()=>{name.hidden=!!who.value};who.onchange=sync;sync();
    const save=el('button',{type:'submit',className:'primary-button compact',textContent:'儲存'});
    queueMicrotask(()=>(who.value?who:name).focus());
    return el('form',{className:'spk-edit',style:`--spk:${colour(speaker.label)}`,onsubmit:async event=>{
      event.preventDefault();save.disabled=true;
      try{
        const updated=await call('PUT',url(`speakers/${speaker.label}`),{username:who.value||null,name:who.value?'':name.value,note:note.value});
        state.speakers=state.speakers.map(s=>s.label===updated.label?updated:s);editing=null;panel();render();
      }catch(error){notice(error.message);save.disabled=false}
    }},el('span',{className:'spk'},el('i'),el('b',{textContent:`S${speaker.label}`})),who,name,note,save,
      el('button',{type:'button',className:'text-button',textContent:'取消',onclick:()=>{editing=null;panel()}}));
  }
  function lane(s){
    const turns=state.turns.map((t,i)=>[t,i]).filter(([t])=>t[2]===s.label);
    return el('div',{className:`spk-lane${selected===s.label?' selected':''}`,style:`--spk:${colour(s.label)}`},
      el('span',{className:'spk-lane-label',textContent:`S${s.label}`,title:s.shown}),
      el('div',{className:'spk-track'},...turns.map(([t,i])=>{
        const bar=el('button',{type:'button',className:'spk-turn',style:`left:${pct(t[0])};width:${pct(t[1]-t[0])}`,
          title:`${s.shown} ${clock(t[0])}–${clock(t[1])}\n${t[3]}`,ariaLabel:`${s.shown} ${clock(t[0])} 起：${t[3]}`,onclick:()=>playFrom(t[0])});
        bar.dataset.turn=i;return bar}),
        el('span',{className:'spk-playhead',hidden:true})));
  }
  function nowPlaying(){
    return el('div',{className:'spk-now',ariaLive:'off'},
      el('button',{type:'button',className:'secondary-button compact spk-toggle',textContent:'▶ 播放',disabled:!meeting.hasRecording,
        onclick:()=>play.active?toggle():playFrom(play.stoppedAt??state.turns[0]?.[0]??0)}),
      el('div',{className:'spk-now-body'},
        el('div',{className:'spk-now-who'},el('i'),el('b'),el('small')),
        el('p',{className:'spk-now-text'},el('span',{className:'said'}),el('span',{className:'rest',textContent:hint()}))));
  }
  const hint=()=>play.stoppedAt!=null?`已停在 ${clock(play.stoppedAt)}，按「播放」從這裡繼續，或點時間軸上的其他發言。`:'點時間軸上的發言，就會從那裡開始播放，文字會跟著聲音顯示。';

  // --- Timeline playback: its own Audio, loaded in parts of up to 5 minutes and played on through the meeting ---
  const audio=new Audio();
  // request: bumped by every start and stop, so audio that arrives for an older request is never played.
  const play={active:false,base:0,end:0,src:null,frame:0,turn:-1,seq:null,request:0,stoppedAt:null};
  const position=()=>play.base+audio.currentTime*1000;
  // Loads [startMs, +5 min) into the player; false when a newer start or a stop came in meanwhile.
  async function loadPart(startMs,request){
    const end=Math.min(state.durationMs,startMs+CHUNK_MS);
    const response=await fetch(`/api/meetings/${meetingId}/audio?start=${Math.floor(startMs)}&end=${Math.ceil(end)}`);
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法載入錄音');
    const blob=await response.blob();
    if(request!==play.request)return false;
    if(play.src)URL.revokeObjectURL(play.src);
    play.src=URL.createObjectURL(blob);
    play.base=startMs;play.end=end;audio.src=play.src;
    return true;
  }
  async function playFrom(startMs){
    if(!meeting.hasRecording)return;
    $('player').pause();   // segment playback and timeline playback never overlap
    const request=++play.request;
    try{
      if(!await loadPart(startMs,request))return;
      play.active=true;play.stoppedAt=null;await audio.play();tick(true);
    }catch(error){if(request===play.request){notice(error.message);stop()}}
  }
  function toggle(){if(audio.paused)audio.play().catch(error=>notice(error.message));else audio.pause();tick(true)}
  function stop(){
    play.request++;   // a part still downloading must not start playing
    if(!play.active)return;
    play.stoppedAt=position();
    audio.pause();play.active=false;cancelAnimationFrame(play.frame);
    tick(true);
  }
  audio.addEventListener('ended',async()=>{
    if(!play.active)return;
    if(play.end<state.durationMs-50){
      const request=play.request;
      try{if(await loadPart(play.end,request))await audio.play()}catch(error){if(request===play.request){notice(error.message);stop()}}
    }else{stop();play.stoppedAt=null;tick(true)}
  });
  for(const event of ['play','pause','timeupdate'])audio.addEventListener(event,()=>tick(event!=='timeupdate'));
  function laneKeys(event){if(event.key===' '&&play.active){event.preventDefault();toggle()}}

  // The turn at a position: the latest one started before it and not yet ended (turns may overlap).
  function turnAt(ms){let found=-1;state.turns.forEach((t,i)=>{if(t[0]<=ms&&ms<t[1])found=i});return found}
  // The segment at a position: segments are stamped after the speech, so each one starts 3 s earlier here; a timed one
  // (segment-audio-times) has the times of the speech itself and starts 0.3 s earlier.
  function segmentAt(ms){let found=null;for(const s of segments)if(s.startMs-(s.timed?TIMED_LEAD_MS:SEGMENT_LEAD_MS)<=ms&&ms<=s.endMs)found=s.seq;return found}
  function tick(force=false){
    cancelAnimationFrame(play.frame);
    const box=$('speakers'),ms=position(),playing=play.active&&!audio.paused;
    for(const head of box.querySelectorAll('.spk-playhead')){head.hidden=!play.active;head.style.left=pct(ms)}
    const index=play.active?turnAt(ms):-1;
    if(index!==play.turn||force){
      box.querySelector('.spk-turn.playing')?.classList.remove('playing');
      if(index>=0)box.querySelector(`.spk-turn[data-turn="${index}"]`)?.classList.add('playing');
      play.turn=index;
    }
    const now=box.querySelector('.spk-now');
    if(now){
      now.querySelector('.spk-toggle').textContent=playing?'❚❚ 暫停':play.active?'▶ 繼續':'▶ 播放';
      const turn=state.turns[index],who=now.querySelector('.spk-now-who');
      if(turn){
        const s=byLabel(turn[2]);
        who.style.setProperty('--spk',colour(turn[2]));
        who.querySelector('b').textContent=s?.shown||`說話者 ${turn[2]}`;
        who.querySelector('small').textContent=`${clock(turn[0])}–${clock(turn[1])}${s?.note?` · ${s.note}`:''}`;
        // MOSS times whole turns only: the spoken part is estimated from the time elapsed in the turn.
        const chars=[...turn[3]],cut=Math.round(chars.length*Math.min(1,Math.max(0,(ms-turn[0])/Math.max(1,turn[1]-turn[0]))));
        now.querySelector('.said').textContent=chars.slice(0,cut).join('');
        now.querySelector('.rest').textContent=chars.slice(cut).join('');
      }else{
        who.querySelector('b').textContent='';who.querySelector('small').textContent=play.active?clock(ms):'';
        now.querySelector('.said').textContent='';now.querySelector('.rest').textContent=play.active?'（沒有人發言）':hint();
      }
      now.classList.toggle('active',play.active);
    }
    const seq=play.active?segmentAt(ms):null;
    if(seq!==play.seq){
      document.querySelector('.seg.speaking')?.classList.remove('speaking');
      play.seq=seq;
      const row=seq!=null&&document.getElementById(`seg-${seq}`);
      // Follow the audio, but never move the page while someone is correcting a segment.
      if(row){row.classList.add('speaking');if(!document.querySelector('.edit-form'))row.scrollIntoView({block:'nearest'})}
    }
    if(playing)play.frame=requestAnimationFrame(()=>tick());
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
  return {load,chip,stop,speaking:()=>play.seq};
})();
