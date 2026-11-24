const $ = (id) => document.getElementById(id);
const EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS';
const translationEmptyMarkup = $('translation').innerHTML;
let socket, stream, captureStreams = [], audioContext, sourceNodes = [], workletNode, startedAt, timerHandle, starting = false, stopping = false;
let recorder, recordingChunks = [], recording, meetingStamp = '', meetingId = '', meetingEpoch = -1, topicUsed = false, sessionPrefix = '';
let testStream, testStreams = [], testAudioContext, testSources = [], testAnalyser, testAnimation, testSilence, testSampler;
// 測試音源 with no sound for this long says so, with advice for the chosen source (audio-test-feedback).
const TEST_SILENCE_MS=5000,TEST_SAMPLE_MS=100;
const silenceAdvice=mode=>mode==='microphone'?'還沒收到聲音：請對麥克風說話，或換一個麥克風來源':'還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放';
let transcript = '', translated = '', draftText = '', translationTimer, pauseTimer, activeTranslation;
let translationOffset = 0, translationHistory = [], translationEpoch = 0, flushRequested = false, lastDraftSource = '';
let tentative = '';   // the cloud engine's text not yet confirmed (mai-intermediate): shown, drafted, never finalized
function pendingSource(){return transcript.slice(translationOffset)+tentative}   // the speech being translated now
let translationFinalNode, translationDraftNode;
let direction = { source: 'auto', target: 'en' };
const languageTags = {none:'—',auto:'AUTO',zh_ja:'中⇄日',zh:'中',en:'EN',ja:'日',ko:'한',fr:'FR',de:'DE',it:'IT',pt:'PT',ru:'RU',es:'ES',ar:'AR'};
const languageSpans=[],utteranceBoundaries=new Set();
// Gateway audio clock (audioMs) at each transcript length, so finalized spans know their place in the recording.
const timeMarks=[];
let fixedTarget='en';
let translationFailures=0;
const segmentRecords=new Map();
// 精準模式 (quality-pass): the gateway's corrected sentences replace live content of the same time range.
let qualityOn=false,quality=QualityView.create(),qualityDown=false;
function qualityChosen(){return !interpretOn()&&!$('qualityRow').hidden&&$('quality').checked}
function qualityShown(){const finals=finalizedRecords();QualityView.promote(quality,finals);return QualityView.view(quality,{transcript,timeMarks,finals})}
function shownTranslated(){if(!qualityOn)return translated;const shown=qualityShown();return [...shown.targets,...shown.liveTargets].join('\n\n')}
// What the meeting keeps: the quality pass's sentences when it is on, the live finalized segments otherwise.
function outputRecords(){return qualityOn?QualityView.promote(quality,finalizedRecords()).records:finalizedRecords()}
let finalizeRemaining=false,sourceRevision=0;
const incompleteClause=s=>TranslationSegmentation.unfinished(s);
const startButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始會議</b><small>即時轉錄與翻譯</small></span>';
const stopButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束會議</b><small>儲存這次記錄</small></span>';
const translateStartContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始翻譯</b><small>即時轉錄與翻譯</small></span>';
const translateStopContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束翻譯</b><small>存成你的紀錄</small></span>';
const interpretStartContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始口譯</b><small>聽譯音、看譯文</small></span>';
const interpretStopContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束口譯</b><small>存成你的紀錄</small></span>';
// The interpreted text so far: finished sentences are the translation, the rest is drawn as the draft.
function interpretText(full){
  // Chinese and Japanese end a sentence without a space after it; other languages need one (or the end) after . ! ?
  const m=/^[\s\S]*(?:[。！？」』）]|[.!?)](?=\s|$))/u.exec(full),done=m?m[0]:'';
  translated=done.trim();draftText=full.slice(done.length).trim();draftSolid=draftText.length;renderTranslation();
  $('translateState').textContent='口譯中';$('translateState').className='state-chip active';
}
// After a session is saved: 在我的紀錄開啟 next to the footer note.
function showSaved(id){if(!id)return;$('savedLink').href=`/interpret?id=${encodeURIComponent(id)}`;$('savedLink').textContent=`已存檔・在我的紀錄開啟`;$('savedLink').hidden=false}
// 即時翻譯's own record: the translation goes to the server every 30 s while it runs (a closed tab loses at most 30 s),
// then once more in full after the session is saved.
const LIVE_SAVE_MS=window.YQ_LIVE_SAVE_MS||30000;
let recordToken='',savedRecord='',sentTranslation='',liveSaveTimer=0;
// With the text go the finished sentences (record-to-meeting), as a meeting keeps them, so the record can become one.
function recordSegments(){
  if(interpretOn())return undefined;   // 即時口譯's translation is spoken, not per sentence
  const cut=t=>String(t||'').slice(0,2000);
  return outputRecords().slice(0,5000).map(s=>{const startMs=Math.max(0,Math.round(s.startMs||0));
    return {startMs,endMs:Math.max(startMs,Math.round(s.endMs||0)),source:cut(s.source),target:cut(s.target),detected:String(s.detected||'').slice(0,16)}});
}
function recordBody(){return JSON.stringify({text:visibleTranslation(),segments:recordSegments()})}
function sendLiveTranslation(){
  const body=recordBody();
  if(!recordToken||body===sentTranslation||(!visibleTranslation()&&!recordSegments()?.length))return;   // nothing yet, or nothing new
  fetch(`/api/interpret/live/${recordToken}/translation`,{method:'PUT',headers:{'content-type':'application/json'},body})
    .then(r=>{if(r.ok)sentTranslation=body}).catch(()=>{});   // tried again at the next interval
}
async function saveFinalTranslation(){
  for(let i=0;i<60&&(activeTranslation||pendingSource().trim()||!savedRecord);i++)await new Promise(r=>setTimeout(r,500));   // the last segments are still being translated
  if(!savedRecord){if(recordToken)toast('最後一段譯文沒有存到紀錄，可以先匯出',6000);return}   // ended without the saved answer
  const id=savedRecord;showSaved(id);
  try{const r=await fetch(`/api/interpret/sessions/${encodeURIComponent(id)}/translation`,{method:'PUT',headers:{'content-type':'application/json'},body:recordBody()});if(!r.ok)throw new Error(r.status)}
  catch{toast('譯文沒有存到紀錄，可以先匯出',6000)}
}
// 即時翻譯 (live-translation) and 即時口譯 (interpret-mode-on-home): the same page without a meeting record; each session
// is saved as the user's own record (我的紀錄). 即時口譯 also counts as translateOnly(): the same layout, no meeting.
function translateOnly(){return document.body.classList.contains('translate-mode')}
// 不翻譯（只整理原文） (transcript-only): a meeting kept in the spoken language only; no translation request at all.
function noTranslation(){return direction.target==='none'}
function interpretOn(){return document.body.classList.contains('interpret-mode')}
const MODE_NOTE={meeting:'建立會議紀錄，會後可校對、產生紀要',translate:'不建立會議紀錄；每次結束存成你的紀錄，只有你看得到',
  interpret:'說話後直接聽到譯音、看到譯文；每次結束存成你的紀錄，只有你看得到'};
function filePrefix(){return sessionPrefix||(translateOnly()?'translate':'meeting')}   // the mode the session ran in, not the switch now
function setLiveMode(mode,persist=true){
  if(stream||starting)return;
  if(mode==='interpret'&&!window.InterpretMode?.usable())mode='translate';   // not granted or not set up: 即時翻譯 instead
  const translate=mode!=='meeting',interpret=mode==='interpret',was=interpretOn();
  document.body.classList.toggle('translate-mode',translate);document.querySelector('.controls').classList.toggle('translate',translate);
  document.body.classList.toggle('interpret-mode',interpret);document.querySelector('.controls').classList.toggle('interpret',interpret);
  const hint=document.querySelector('#transcript .empty-state small');   // the empty transcript names this mode's button
  if(hint)hint.textContent=`點擊「${interpret?'開始口譯':translate?'開始翻譯':'開始會議'}」，逐字稿將即時顯示`;
  for(const b of document.querySelectorAll('.mode-btn'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
  $('modeNote').textContent=MODE_NOTE[mode];
  $('start').innerHTML=interpret?interpretStartContent:translate?translateStartContent:startButtonContent;
  $('storeNote').textContent=translate?'存成你的紀錄，只有你看得到':'錄音與逐字稿存入會議紀錄';
  if(interpret!==was)window.InterpretMode?.activate(interpret);   // 即時口譯 swaps the menu of output languages in and out
  // 不翻譯 is for meetings only (transcript-only): hidden in the other modes, where a chosen 不翻譯 becomes English; back in
  // 開會 the remembered choice returns. Done after the swap, on the menu that is shown now.
  const none=$('targetLanguage').querySelector('option[value="none"]');
  if(none)none.hidden=translate;
  if(translate&&!interpret&&$('language').value!=='zh_ja'){const kept=recalled('translateTarget'),option=kept&&kept!=='none'&&$('targetLanguage').querySelector(`option[value="${CSS.escape(kept)}"]`);if(option&&!option.hidden)$('targetLanguage').value=kept}
  if(translate&&$('targetLanguage').value==='none')$('targetLanguage').value='en';
  else if(!translate&&none&&rememberedTarget&&$('language').value!=='zh_ja'&&$('targetLanguage').querySelector(`option[value="${CSS.escape(rememberedTarget)}"]`))$('targetLanguage').value=rememberedTarget;
  if(translate&&fixedTarget==='none')fixedTarget='en';
  updateTranslationDirection();
  showPrivacy();
  if(persist){try{localStorage.setItem('liveMode',mode)}catch{}}
}
for (let i=0; i<14; i++) $('wave').appendChild(document.createElement('i'));

function applyTheme(theme, persist=true){
  const selected=theme==='light'?'light':'dark',light=selected==='light';
  document.documentElement.dataset.theme=selected;
  const button=$('themeToggle');
  button.setAttribute('aria-pressed',String(light));
  button.setAttribute('aria-label',light?'切換至暗色主題':'切換至明亮主題');
  button.title=light?'切換至暗色主題':'切換至明亮主題';
  button.querySelector('.theme-label').textContent=light?'暗色':'明亮';
  $('themeColor').content=getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  if(persist){try{localStorage.setItem('interpreter-theme',selected)}catch{}}
}
let savedTheme='dark';
try{savedTheme=localStorage.getItem('interpreter-theme')==='light'?'light':'dark'}catch{}
applyTheme(savedTheme,false);
$('themeToggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');

function setStatus(text, kind='idle') { $('status').className = `status ${kind}`; $('status').querySelector('span').textContent = text; $('status').title=text; }
// What the subtitle surfaces show: the previous finalized segment's source, the speech being translated now, the last
// two finalized translations and the draft (live-subtitle-segments).
// history: the recent finalized segments for the floating window, which shows as many as it has room for.
const SUBTITLE_HISTORY=30;
function subtitleParts(){
  const pending=transcript.slice(translationOffset),last=s=>window.Subtitles?.lastSentences(s,1)||'';
  if(qualityOn){
    const all=[...quality.records,...qualityShown().liveFinals];
    return {done:all.at(-1)?.source||'',pending:quality.done?'':pending+tentative,translation:all.slice(-2).map(s=>s.target).join(' '),draft:quality.done?'':draftText,draftSolid,
      history:all.slice(-SUBTITLE_HISTORY).map(s=>({source:s.source,target:s.target}))};
  }
  if(interpretOn()){   // 即時口譯: the interpreted text as sentences; the source is the recognized speech
    const sentences=window.Subtitles?.sentences(translated)||[];
    return {done:'',pending:(window.Subtitles?.lastSentences(transcript,2)||'')+tentative,translation:window.Subtitles?.joinSentences(sentences.slice(-2))||'',draft:draftText,draftSolid,
      history:sentences.slice(-SUBTITLE_HISTORY).map(target=>({source:'',target}))};
  }
  if(noTranslation()){   // 不翻譯: the spoken text is the subtitle, its finished sentences and the rest as the draft
    const finals=finalizedRecords();
    return {done:'',pending:'',translation:finals.slice(-2).map(s=>s.source).join(' '),draft:(pending+tentative).trim(),draftSolid:0,
      history:finals.slice(-SUBTITLE_HISTORY).map(s=>({source:'',target:s.source}))};
  }
  if(!translateOnly()){   // 開會: sentences, as before; the translation is split once for both the last two and the history
    const sentences=window.Subtitles?.sentences(translated)||[];
    return {done:last(transcript.slice(0,translationOffset)),pending:pending+tentative,translation:window.Subtitles?.joinSentences(sentences.slice(-2))||'',draft:draftText,draftSolid,
      history:sentences.slice(-SUBTITLE_HISTORY).map(target=>({source:'',target}))};
  }
  const finals=finalizedRecords();
  return {done:finals.at(-1)?.source||'',pending:pending+tentative,translation:finals.slice(-2).map(s=>s.target).join(' '),draft:draftText,draftSolid,
    history:finals.slice(-SUBTITLE_HISTORY).map(s=>({source:s.source,target:s.target}))};
}
// A pane follows its newest text with a smooth scroll (smooth-subtitles). It follows from the start; once the user
// has scrolled it, only while its view is within 72 px of the end, so reading earlier text is never interrupted.
let draftSolid=0;   // how much of draftText is settled; the rest is drawn lighter (Subtitles.solid)
const paneFollows=new WeakMap(),lessMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
function follows(el){if(el.classList.contains('empty')||paneFollows.get(el)!==false||el.scrollHeight-el.scrollTop-el.clientHeight<72){paneFollows.set(el,true);return true}return false}
function toEnd(el){const top=el.scrollHeight-el.clientHeight;if(lessMotion?.matches||!el.scrollTo)el.scrollTop=top;else el.scrollTo({top,behavior:'smooth'})}
// The user takes over by scrolling up with the wheel, dragging with a finger, or pressing on the scrollbar; a click
// in the text (selecting, copying) does not stop the pane.
for(const id of ['transcript','translation'])for(const type of ['wheel','touchmove','mousedown'])$(id).addEventListener(type,event=>{
  if(type==='wheel'?event.deltaY<0:type==='mousedown'?event.offsetX>=event.currentTarget.clientWidth:true)paneFollows.set(event.currentTarget,false)},{passive:true});
function render(id, value) { if(id==='transcript'){const parts=subtitleParts();window.Subtitles?.update(parts);window.Overlay?.update(parts)} const el=$(id),follow=follows(el);
  if(id==='transcript'&&qualityOn){   // kept sentences in paragraphs (split at pauses), the live text right after them (quality-transcript-flow)
    const shown=qualityShown(),kept=QualityView.paragraphs(quality.records).join('\n\n'),make=(name,text)=>Object.assign(document.createElement('span'),{className:name,textContent:text});
    el.replaceChildren(...(kept?[make('quality-kept',kept)]:[]),...(shown.liveSource?[make('quality-live',QualityView.join(kept,shown.liveSource).slice(kept.trimEnd().length))]:[]));
    value=kept+shown.liveSource;
  }else el.textContent=value;
  if(id==='transcript'&&tentative){const span=document.createElement('span');span.className='tentative';span.textContent=tentative;el.append(span)}
  el.classList.toggle('empty', !value&&!(id==='transcript'&&tentative)); updateCounts(); if((value||tentative)&&follow) toEnd(el); }
function visibleTranslation(){const translated=shownTranslated();return translated+(translated&&draftText?'\n':'')+draftText}
function renderTranslation(){
  const parts=subtitleParts(),translated=shownTranslated();
  window.Subtitles?.update(parts);   // the floating subtitles (live-translation)
  window.Overlay?.update(parts);   // 畫面＋字幕 (screen-subtitles)
  const el=$('translation'),wasEmpty=el.classList.contains('empty');
  const follow=follows(el);
  if(!translated&&!draftText){
    el.classList.add('empty');el.innerHTML=translationEmptyMarkup;
    translationFinalNode=translationDraftNode=null;updateCounts();return;
  }
  if(wasEmpty){el.replaceChildren();el.classList.remove('empty')}
  if(translated){
    if(!translationFinalNode){translationFinalNode=document.createElement('span');el.prepend(translationFinalNode)}
    if(translationFinalNode.textContent!==translated)translationFinalNode.textContent=translated;
  }
  if(draftText){
    if(!translationDraftNode){translationDraftNode=document.createElement('span');translationDraftNode.className='translation-draft';el.appendChild(translationDraftNode)}
    if(window.Subtitles)Subtitles.setDraft(translationDraftNode,draftText,draftSolid);else if(translationDraftNode.textContent!==draftText)translationDraftNode.textContent=draftText;
  }else if(translationDraftNode){translationDraftNode.remove();translationDraftNode=null}
  updateCounts();if(follow)toEnd(el);
}
function updateCounts(){ $('transcriptCount').textContent=`${transcript.length.toLocaleString()} 字`; $('translationCount').textContent=`${visibleTranslation().length.toLocaleString()} 字`; }
function toast(message,duration=2200){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),duration)}
const screenAwake=ScreenAwake.create(navigator,document);   // screen-awake: held while a session runs
function setControls(active){active?screenAwake.hold():screenAwake.release();for(const b of document.querySelectorAll('.mode-btn'))b.disabled=active||b.dataset.locked==='1';const pair=direction.source==='zh_ja';$('language').disabled=active;$('targetLanguage').disabled=active||pair;$('audioSource').disabled=active;$('microphone').disabled=active;$('testMic').disabled=active;$('context').disabled=active;$('team').disabled=active;$('topic').disabled=active;window.MeetingSeries?.lock(active);$('cloudRefine').disabled=active||qualityChosen();$('quality').disabled=active;$('swap').disabled=active||pair||interpretOn()||noTranslation();$('liveBar').classList.toggle('visible',active);$('liveBar').setAttribute('aria-hidden',String(!active));
  syncLiveSession();placeStart();showSentence()}   // wide windows fold the setup into the floating bar (ui-night-celadon)
// chosen: the user picked the language or 翻譯成 (or swapped them); only then is it remembered (remember-setup-choices),
// never when the page adjusts a control by itself (a mode without 不翻譯 or 中日雙向).
function updateTranslationDirection(chosen=false){
  const pair=$('language').value==='zh_ja';
  if(pair){if($('targetLanguage').value!=='zh_ja')fixedTarget=$('targetLanguage').value;$('targetLanguage').value='zh_ja'}
  else if($('targetLanguage').value==='zh_ja')$('targetLanguage').value=fixedTarget==='none'&&translateOnly()?'en':fixedTarget;
  $('targetLanguage').disabled=Boolean(stream)||pair;$('swap').disabled=Boolean(stream)||pair||interpretOn();   // 即時口譯 translates one way
  direction={source:$('language').value,target:$('targetLanguage').value};
  if(!pair&&direction.source===direction.target){$('targetLanguage').value=direction.source==='en'?'zh':'en';direction.target=$('targetLanguage').value}
  document.body.classList.toggle('no-translation',noTranslation());
  if(!translateOnly()&&!pair)rememberedTarget=direction.target;   // 開會's 翻譯成 (不翻譯 included) comes back after another mode
  if(chosen===true){
    // One spoken language for the three modes; 翻譯成 for 開會 and for 即時翻譯 apart (即時口譯 keeps its own, interpret-mode.js).
    remember('meetingLanguage',direction.source);
    if(!pair&&!interpretOn())remember(translateOnly()?'translateTarget':'meetingTarget',direction.target);
  }
  if(noTranslation())$('swap').disabled=true;   // nothing to swap with
  translationEpoch++;activeTranslation?.abort();activeTranslation=null;clearTimeout(translationTimer);clearTimeout(pauseTimer);translated='';draftText='';translationOffset=0;translationHistory=[];flushRequested=false;lastDraftSource='';translationFailures=0;renderTranslation();
  const tags=$('swap').querySelectorAll('.lang-tag');const swapPair=direction.source==='zh_ja';   // 中 ⇆ 日, not 中⇄日 twice
  tags[0].textContent=swapPair?'中':languageTags[direction.source]||direction.source.toUpperCase();tags[1].textContent=swapPair?'日':languageTags[direction.target]||direction.target.toUpperCase();
  $('targetLabel').textContent=pair?'中日雙向翻譯':noTranslation()?'不翻譯':`翻譯成 ${$('targetLanguage').selectedOptions[0].textContent}`;
  const startNote=$('start').querySelector('.button-copy small');   // 開會: 不翻譯 only transcribes
  if(startNote&&!translateOnly()&&!stream)startNote.textContent=noTranslation()?'即時轉錄，不翻譯':'即時轉錄與翻譯';
  $('targetLabel').closest('.card-title').querySelector('.language-dot').textContent=languageTags[direction.target]||direction.target.toUpperCase();
  $('translateState').textContent='就緒';$('translateState').className='state-chip';
  if(transcript)scheduleTranslation(true);
  showPrivacy();   // the spoken language decides the engine, and so where the audio goes
  showSentence();
}
function selectedSource(){return $('audioSource').value}
// Microphone names (ui-sentence-menus): no trailing USB code; Windows' Default / Communications devices are marked after
// the name. The sentence leaves the mark out.
function micName(label){
  const name=String(label||'').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i,'');
  const mark=name.match(/^(Default|Communications) - (.+)$/);
  return mark?`${mark[2]}（${mark[1]==='Default'?'系統預設':'通訊'}）`:name;
}
// The setup as one sentence (ui-night-celadon, meeting-setup-layout): wide windows show it as the page title; each named
// setting is a button that focuses its own control and opens a menu's list. During a session it is plain text.
function sentenceState(){
  const label=id=>$(id).selectedOptions?.[0]?.textContent.trim()||'',team=$('team'),hasTeam=!team.hidden&&team.options.length>0;
  return {mode:interpretOn()?'interpret':translateOnly()?'translate':'meeting',source:$('language').value,sourceLabel:label('language'),
    target:$('targetLanguage').value,targetLabel:interpretOn()?label('targetLanguage').replace(/（.*/,'').replace(/\s+[㐀-鿿]+$/,''):label('targetLanguage'),   // 口譯's menu is bilingual: English 英文 → English
    audio:selectedSource(),micLabel:label('microphone').replace(/（(系統預設|通訊)）$/,''),
    team:hasTeam?team.value:'',teamLabel:hasTeam?label('team'):'',play:$('interpretPlay').checked};
}
function showSentence(){
  const box=$('setupSentence');if(!box||!window.SetupSentence)return;
  window.SentenceMenu?.close(false);   // its word is about to be replaced
  const names={language:'語音語言',targetLanguage:'翻譯成',audioSource:'音訊來源',microphone:'麥克風來源',team:'團隊',interpretPlay:'同步播放譯音'};
  const live=document.body.classList.contains('live-session');
  // One span per clause (ui-setup-collapse): lines break between clauses, a clause wider than the line still wraps.
  const clauses=[],clause=()=>{const span=Object.assign(document.createElement('span'),{className:'sentence-clause'});clauses.push(span);return span};
  let current=clause();
  for(const part of SetupSentence.compose(sentenceState())){
    if(part.field&&!live&&!$(part.field)?.disabled){
      const button=Object.assign(document.createElement('button'),{type:'button',className:'sentence-pick',textContent:part.text});
      button.dataset.field=part.field;button.setAttribute('aria-label',`更改${names[part.field]}`);
      button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-controls','sentenceMenu');button.setAttribute('aria-expanded','false');
      current.append(button);continue;
    }
    for(const piece of part.text.split(/(?<=，)/)){if(!piece)continue;current.append(piece);if(piece.endsWith('，'))current=clause()}
  }
  box.replaceChildren(...clauses.filter(span=>span.textContent));
}
$('setupSentence').addEventListener('click',event=>{
  const button=event.target.closest('.sentence-pick'),control=button&&$(button.dataset.field);if(!control)return;
  // ui-sentence-menus: the word opens its own menu below it; the setup stays folded or unfolded as it is.
  SentenceMenu.open(button,control,field=>document.querySelector(`#setupSentence .sentence-pick[data-field="${field}"]`)?.focus());
});
function updateSourceUI(){const mode=selectedSource(),system=mode!=='microphone';$('sourceHint').hidden=!system;   // the headphone tip is gone; sharing steps stay
  $('microphone').closest('.mic-field').classList.toggle('is-hidden',mode==='system');$('sourceHint').textContent=system?'點「測試音源」或「開始會議」後，在 Chrome 分享視窗勾選「分享分頁音訊」或「分享系統音訊」。只選畫面、不分享音訊，無法轉錄。'+(mode==='mixed'?'混合模式也會收取麥克風；建議使用耳機。':''):'使用耳機開會可避免喇叭聲被麥克風重複收進來。';$('testMic').querySelector('small').textContent=system?'開啟分享選擇器':'確認有聲音';if(!testStream)mediaUnavailable()?setMicStatus(mediaUnavailable(),'error'):setMicStatus(system?'尚未連接分享音訊':'尚未測試音源');showSentence()}
// Before the browser gives access, the list has no device ids: the remembered microphone is asked for as `ideal`, so the
// first test or meeting after a reload opens it (remember-setup-choices), or the default one when it is unplugged.
function audioConstraints(){const selected=$('microphone').value,unnamed=[...$('microphone').options].every(o=>!o.value),kept=unnamed&&!micChosen?recalled('microphoneId'):'';return{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(selected&&selected!=='default'?{deviceId:{exact:selected}}:kept?{deviceId:{ideal:kept}}:{})}}
function setMicStatus(text,kind=''){$('micStatus').textContent=text;$('micStatus').className=kind}
// Browsers offer media capture only on secure pages (https or localhost): over http the API is missing and calling it
// throws a script error nobody can act on (microphone-access).
function mediaUnavailable(){
  if(!window.isSecureContext)return'需要 https 連線才能使用麥克風';
  if(!navigator.mediaDevices?.getUserMedia)return'此瀏覽器不支援麥克風';
  return'';
}
function mediaUnavailableError(){
  const reason=mediaUnavailable();if(!reason)return null;
  // The https address only for a plain hostname on the default port: an IP address or an explicit port (the LAN's
  // http://192.168.x.x:18082) has no https at that address, so naming it would send people nowhere.
  const plain=!location.port&&!/^[\d.]+$|^\[/.test(location.hostname);
  const advice=window.isSecureContext?'請改用新版 Chrome、Edge 或 Safari 開啟':plain?`請改用 https://${location.hostname}${location.pathname}${location.search} 開啟`:'請改用 https 網址，或在這台電腦上以 localhost 開啟';
  const error=new Error(`${reason}，${advice}`);
  error.name='MediaUnavailableError';error.status=reason;return error;
}
async function microphonePermission(){try{return(await navigator.permissions.query({name:'microphone'})).state}catch{return'unknown'}}
async function requestMicrophone(){
  const unavailable=mediaUnavailableError();if(unavailable)throw unavailable;
  let expired=false,timer;
  const request=navigator.mediaDevices.getUserMedia({audio:audioConstraints()});
  request.then(result=>{if(expired)result.getTracks().forEach(track=>track.stop())}).catch(()=>{});
  try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new DOMException('請在 Chrome 網址列允許此網站使用麥克風','NotAllowedError'))},10000)})])}finally{clearTimeout(timer)}
}
async function requestDisplayAudio(){
  const unavailable=mediaUnavailableError();if(unavailable)throw unavailable;
  if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('此瀏覽器不支援分頁／系統音訊分享，請使用新版 Chrome 並透過 localhost 或 HTTPS 開啟');
  const display=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true,systemAudio:'include',windowAudio:'system',surfaceSwitching:'include',selfBrowserSurface:'exclude'});
  if(!display.getAudioTracks().length){display.getTracks().forEach(track=>track.stop());throw new Error('沒有取得分享音訊。請重新選擇分頁並勾選「分享分頁音訊」，或在分享整個畫面時勾選「分享系統音訊」。')}
  return display;
}
async function acquireAudio(){
  const mode=selectedSource(),streams=[];
  try{
    if(mode!=='microphone')streams.push(await requestDisplayAudio());
    if(mode!=='system')streams.push(await requestMicrophone());
    return streams;
  }catch(error){streams.forEach(media=>media.getTracks().forEach(track=>track.stop()));throw error}
}
function streamLabel(streams){const names=streams.flatMap(media=>media.getAudioTracks().map(track=>track.label)).filter(Boolean);return names.join(' + ')||'已連接音訊'}
// remember-setup-choices: what the user chose stays after a reload or 清除. Storage that cannot be used is ignored.
function remember(key,value){try{localStorage.setItem(key,value)}catch{}}
function recalled(key){try{return localStorage.getItem(key)||''}catch{return ''}}
let micChosen=false;   // the user picked a microphone since the page loaded
async function refreshMicrophones(preferredId=''){
  if(mediaUnavailable()){setMicStatus(mediaUnavailable(),'error');return}
  if(!navigator.mediaDevices?.enumerateDevices){setMicStatus('瀏覽器不支援裝置選擇','error');return}
  const permission=await microphonePermission();
  if(permission==='denied')setMicStatus('Chrome 已封鎖麥克風，請在網址列解除','error');
  else if(permission==='prompt')setMicStatus('請先按「測試音源」並允許麥克風');
  const shown=$('microphone').value;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  $('microphone').innerHTML='';
  devices.forEach((device,index)=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=micName(device.label)||`麥克風 ${index+1}`;$('microphone').appendChild(option)});
  if(!devices.length){const option=document.createElement('option');option.value='default';option.textContent='找不到麥克風';$('microphone').appendChild(option);setMicStatus('沒有可用的輸入裝置','error');return}
  // Which one stays selected: the one in use, else the remembered one by its id (what the user chose last, on this visit
  // or an earlier one), else, until the user chooses on this visit, the remembered one by its name (ids change when site
  // data is cleared), else the one shown before, else the first. Only a choice by the user is stored (the microphone's
  // change event), so a microphone that is unplugged or drops out is selected again when it returns.
  const options=[...$('microphone').options],has=id=>id&&options.some(o=>o.value===id);
  const byName=!micChosen&&recalled('microphoneLabel')?options.find(o=>o.textContent===recalled('microphoneLabel'))?.value:'';
  const pick=[preferredId,recalled('microphoneId'),byName,shown].find(has);
  if(pick)$('microphone').value=pick;
  showSentence();
}
function stopMicTest(){cancelAnimationFrame(testAnimation);clearTimeout(testSilence);clearInterval(testSampler);testSources.forEach(source=>source.disconnect());testStreams.forEach(media=>media.getTracks().forEach(track=>track.stop()));testAudioContext?.close();testStream=testAudioContext=testAnalyser=null;testStreams=[];testSources=[];$('testMic').classList.remove('testing');$('testMic').querySelector('b').textContent='測試音源';$('microphone').disabled=false;$('audioSource').disabled=false;$('micTestLevel').style.transform='scaleX(.03)';updateSourceUI()}
async function toggleMicTest(){
  if(testStream){stopMicTest();setMicStatus('測試已結束');return}
  try{
    setMicStatus('正在連接音源…','checking');$('testMic').disabled=true;
    testStreams=await acquireAudio();testStream=testStreams[0];
    const track=testStream.getAudioTracks()[0],label=streamLabel(testStreams);
    if(selectedSource()==='microphone')await refreshMicrophones(track.getSettings().deviceId);
    $('activeMic').textContent=label;setMicStatus(`已連接：${label}`,'ok');
    testAudioContext=new AudioContext();testAnalyser=testAudioContext.createAnalyser();testAnalyser.fftSize=1024;
    for(const media of testStreams){const source=testAudioContext.createMediaStreamSource(media);source.connect(testAnalyser);testSources.push(source)}
    const samples=new Float32Array(testAnalyser.fftSize);let peak=0;
    const analyser=testAnalyser,level=()=>{analyser.getFloatTimeDomainData(samples);let sum=0;for(const value of samples)sum+=value*value;return Math.min(1,Math.sqrt(sum/samples.length)*8)};
    // Whether sound arrives is sampled on a timer, not only in the drawing loop: sharing a tab usually brings that tab
    // to the front, and a page in the background gets no animation frames. The status is written only when it changes
    // (it is announced to screen readers).
    let heard=false,shown='';const mode=selectedSource();
    const signal=()=>{heard=true;if(shown!=='ok'){shown='ok';setMicStatus(`訊號正常：${label}`,'ok')}};
    const draw=()=>{peak=Math.max(level(),peak*.94);$('micTestLevel').style.transform=`scaleX(${Math.max(.03,peak)})`;if(peak>.08)signal();testAnimation=requestAnimationFrame(draw)};
    clearInterval(testSampler);testSampler=setInterval(()=>{if(level()>.08)signal()},TEST_SAMPLE_MS);
    clearTimeout(testSilence);testSilence=setTimeout(()=>{if(level()>.08)signal();if(!heard){shown='silent';setMicStatus(silenceAdvice(mode),'error')}},TEST_SILENCE_MS);
    draw();
    $('testMic').classList.add('testing');$('testMic').querySelector('b').textContent='結束測試';$('testMic').querySelector('small').textContent=selectedSource()==='microphone'?'請對麥克風說話':'請播放影片或會議音訊';$('microphone').disabled=true;$('audioSource').disabled=true;$('testMic').disabled=false;showSentence();   // their words are plain text while the test runs
    testStreams.forEach(media=>media.getTracks().forEach(mediaTrack=>mediaTrack.onended=()=>{stopMicTest();setMicStatus('音源已中斷','error')}));
  }catch(error){stopMicTest();setMicStatus(error.status||(error.name==='NotAllowedError'?(error.message||'Chrome 未允許麥克風'):'無法連接所選音源'),'error');toast(error.message,error.status?8000:undefined)}finally{$('testMic').disabled=false}
}
function resampleTo16k(input, inputRate) {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000, length = Math.round(input.length / ratio), output = new Float32Array(length);
  for (let i=0;i<length;i++) { const p=i*ratio, a=Math.floor(p), b=Math.min(a+1,input.length-1), f=p-a; output[i]=input[a]*(1-f)+input[b]*f; }
  return output;
}
function floatToPCM16(samples) { const out=new Int16Array(samples.length); for(let i=0;i<samples.length;i++) out[i]=Math.max(-1,Math.min(1,samples[i]))*0x7fff; return out; }

async function startMeeting() {
  if(starting || stream)return;
  const translate=translateOnly(),teamId=Number($('team').value);
  if(!translate&&!teamId){setStatus(NO_TEAM,'error');toast(NO_TEAM,5000);return}
  starting=true;$('start').disabled=true;
  try {
    if(testStream)stopMicTest();setStatus('正在檢查音源…');resetLearnedTerms();
    captureStreams = await acquireAudio();stream=captureStreams[0];
    const label=streamLabel(captureStreams);$('activeMic').textContent=label;setMicStatus(`使用中：${label}`,'ok');
    window.Overlay?.setTrack(captureStreams[0].getVideoTracks()[0]||null);   // the shared picture for 畫面＋字幕; null with a microphone alone
    if(selectedSource()==='microphone')await refreshMicrophones(stream.getAudioTracks()[0].getSettings().deviceId);
    captureStreams.forEach(media=>media.getTracks().forEach(track=>track.onended=()=>{if(stream && !stopping){stopMeeting(false).then(()=>{setStatus('分享或麥克風已停止','error');setMicStatus('音源已中斷','error')})}}));
    setStatus('正在連線…');
    const interpret=interpretOn();
    sessionPrefix=interpret?'interpret':translate?'translate':'meeting';$('savedLink').hidden=true;recordToken='';savedRecord='';sentTranslation='';
    if(translate)meetingId='';else{meetingId=await createMeeting(teamId);topicUsed=true;window.MeetingSeries?.started(meetingId)}
    resetMeetingState();
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws/transcribe`);
    socket.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=()=>reject(new Error('連線失敗')); });
    qualityOn=qualityChosen();
    if(interpret)await window.InterpretMode.start({target:$('targetLanguage').value,sourceLang:$('language').value,onText:interpretText,
      onError:message=>toast(message,6000),onEnd:(why,saved)=>{if(stream&&!stopping)stopMeeting(false).then(()=>{showSaved(saved);setStatus(why||'口譯已結束',why?'error':'idle')})}});
    socket.send(JSON.stringify({requestId:crypto.randomUUID(),meeting_id:meetingId,mode:interpret?'interpret':translate?'translate':'meeting',language:$('language').value,use_vad:direction.source==='zh_ja',system_prompt:interpret?'':$('context').value,engine:asrEngine(),refine:cloudRefineOn(),quality:qualityOn,target:direction.target}));
    socket.onmessage = onMessage;
    socket.onclose = onSocketClose;

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule('/assets/pcm-worklet.js?v=20261108a');
    workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
    workletNode.port.onmessage = ({data}) => { let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];$('level').style.transform=`scaleX(${Math.min(1,Math.sqrt(sum/data.length)*5+.03)})`;if(socket?.readyState===WebSocket.OPEN)socket.send(floatToPCM16(resampleTo16k(data,audioContext.sampleRate)).buffer);if(interpretOn())window.InterpretMode.feed(data,audioContext.sampleRate); };
    for(const media of captureStreams){const node=audioContext.createMediaStreamSource(media),gain=audioContext.createGain();gain.gain.value=captureStreams.length>1?0.5:1;node.connect(gain).connect(workletNode);sourceNodes.push(node,gain)}
    startRecording(sourceNodes.filter((_,i)=>i%2));
    const silent=audioContext.createGain();silent.gain.value=0;workletNode.connect(silent).connect(audioContext.destination);sourceNodes.push(silent);
    await audioContext.resume();
    startedAt=Date.now(); timerHandle=setInterval(updateTimer,1000); updateTimer();
    $('start').innerHTML=interpret?interpretStopContent:translate?translateStopContent:stopButtonContent; $('start').classList.add('stop'); setControls(true); setStatus(interpret?'即時口譯中':translate?'即時翻譯中':'即時轉錄中','live');
    if(translate&&!interpret)liveSaveTimer=setInterval(sendLiveTranslation,LIVE_SAVE_MS);
  } catch (error) { await stopMeeting(false);setStatus(error.message,'error');setMicStatus(error.status||error.message,'error');toast(error.message,error.status?8000:5000); }
  finally{starting=false;$('start').disabled=false}
}

async function stopMeeting(sendEos=true) {
  if(stopping)return;stopping=true;
  // faster-meeting-end: closing takes a few seconds (the last sentences); say so instead of looking stuck.
  $('start').disabled=true;$('start').querySelector('.button-copy b')?.replaceChildren('結束中…');$('start').querySelector('.button-copy small')?.replaceChildren(qualityOn?'正在完成最後幾句':'正在儲存');
  if(qualityOn)setStatus('正在完成最後幾句…','live');
  await stopRecording().catch(error=>toast(`錄音儲存失敗：${error.message}`,5000));
  workletNode?.disconnect();sourceNodes.forEach(node=>{try{node.disconnect()}catch{}});
  if(workletNode)workletNode.port.onmessage=null;
  if(sendEos && socket?.readyState===WebSocket.OPEN) {
    const closingSocket=socket;
    await new Promise(resolve=>{const timer=setTimeout(()=>{closingSocket.removeEventListener('close',done);toast('辨識收尾逾時，請核對最後一句',5000);resolve()},qualityOn?70000:20000);function done(){clearTimeout(timer);resolve()}closingSocket.addEventListener('close',done,{once:true});closingSocket.send(EOS)});
  }
  // 即時口譯: the last source text arrived with EOS above; now the interpreter finishes and saves the session.
  const interpreted=sessionPrefix==='interpret'?await window.InterpretMode.stop():null;
  clearInterval(liveSaveTimer);
  // 精準模式: no final event (the connection dropped, or the wait ran out) means the rest was not replaced; keep it.
  if(qualityOn&&!quality.done)QualityView.apply(quality,{failed:true,final:true,throughMs:quality.throughMs},finalizedRecords());
  finalizeRemaining=true;
  window.Overlay?.setTrack(null);
  try{socket?.close();}catch{} captureStreams.forEach(media=>media.getTracks().forEach(track=>{track.onended=null;track.stop()}));
  try{sourceNodes.forEach(node=>node.disconnect());workletNode?.disconnect();await audioContext?.close();}catch{}
  tentative='';render('transcript',transcript);
  socket=stream=audioContext=null;captureStreams=[];sourceNodes=[];workletNode=null;clearInterval(timerHandle);$('start').innerHTML=interpretOn()?interpretStartContent:translateOnly()?translateStartContent:startButtonContent;$('start').classList.remove('stop');setControls(false);if(topicUsed){$('topic').value='';topicUsed=false}setMicStatus(`已確認：${$('activeMic').textContent}`,'ok');setStatus(transcript||interpreted?(sessionPrefix==='interpret'?(interpreted?'口譯已結束，已存到我的紀錄':'口譯已結束'):translateOnly()?'翻譯已結束':'會議已結束'):'系統待機');if(interpreted)showSaved(interpreted);scheduleTranslation(true);if(sessionPrefix==='translate')saveFinalTranslation();storeTranscript();if(meetingId)window.MeetingSeries?.ended(meetingId);stopping=false;$('start').disabled=false;
}
// The meeting audio is kept only in this browser and saved next to the exported transcript.
function startRecording(gains){
  recording=null;recordingChunks=[];meetingStamp=new Date().toISOString().slice(0,19).replaceAll(':','-');$('downloadAudio').hidden=true;
  if(!window.MediaRecorder)return toast('此瀏覽器不支援錄音，僅進行轉錄',4000);
  const destination=audioContext.createMediaStreamDestination();gains.forEach(gain=>gain.connect(destination));sourceNodes.push(destination);
  const mimeType=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type))||'';
  recorder=new MediaRecorder(destination.stream,{...(mimeType&&{mimeType}),audioBitsPerSecond:64000});
  recorder.ondataavailable=({data})=>{if(data.size)recordingChunks.push(data)};recorder.start(1000);
}
async function stopRecording(){
  if(!recorder)return;const active=recorder;recorder=null;
  if(active.state!=='inactive')await new Promise(resolve=>{active.onstop=resolve;active.stop()});
  if(!recordingChunks.length)return;
  recording=new Blob(recordingChunks,{type:active.mimeType||'audio/webm'});recordingChunks=[];$('downloadAudio').hidden=false;
  await storeMeetingFile(recording,'recording',recordingName());
}
function saveFile(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function recordingName(){return `${filePrefix()}-${meetingStamp}.${recording.type.includes('mp4')?'m4a':recording.type.includes('ogg')?'ogg':'webm'}`}
function saveRecording(){if(!recording)return toast('目前沒有錄音');saveFile(recording,recordingName())}
// Each meeting's audio and transcript are stored with the meeting record on the server for later review;
// if the server cannot store them, the browser download keeps them from being lost.
async function storeMeetingFile(blob,kind,name,id=meetingId){
  if(!id&&translateOnly())return;   // 即時翻譯: the file stays in the browser (download only)
  try{if(!id)throw new Error('沒有會議編號');const response=await fetch(`/api/meetings/${id}/files/${kind}`,{method:'PUT',headers:{'content-type':blob.type||'application/octet-stream'},body:blob});if(!response.ok)throw new Error((await response.json()).detail||response.status);toast(`已儲存 ${(await response.json()).saved}`,3000)}
  catch(error){toast(`無法存入會議紀錄（${error.message}），改為下載`,5000);saveFile(blob,name)}
}
function transcriptFile(){
  const kept=qualityOn?outputRecords():[...segmentRecords.values()].filter(s=>s.state==='finalized');
  const pairs=kept.map((s,i)=>`[${i+1}] ${s.source}\n→ ${s.target}`).join('\n\n');
  const shown=qualityOn?qualityShown():null,original=shown?[...shown.sources,shown.liveSource].filter(Boolean).join('\n'):transcript;
  const learned=learnedTerms?`\n\n自動學習詞彙\n${learnedTerms}`:'';
  return new Blob([`原文\n${original}\n\n翻譯\n${visibleTranslation()}\n\n逐段對照\n${pairs}${learned}\n`],{type:'text/plain;charset=utf-8'});
}
let transcriptSaveTimer,saveTranscriptNow=null;
// A new meeting starts empty: the previous one's text, translations and terms belong to its own
// meeting (maybe another team) and must never be saved into the new meeting's transcript.
function resetMeetingState(){
  saveTranscriptNow?.();saveSegmentsNow?.();
  transcript='';tentative='';sourceRevision=0;finalizeRemaining=false;quality=QualityView.create();qualityDown=false;
  segmentRecords.clear();languageSpans.length=0;utteranceBoundaries.clear();timeMarks.length=0;
  updateTranslationDirection();meetingEpoch=translationEpoch;resetLearnedTerms();render('transcript','');
  ownSegments(meetingId);   // after the previous meeting's segments were flushed and cleared
}
// Debounced; bound to the meeting it was scheduled for, and flushed at once if a new meeting starts first.
function storeTranscript(){
  clearTimeout(transcriptSaveTimer);saveTranscriptNow=null;storeSegments();
  if(!meetingId||!transcript||translationEpoch!==meetingEpoch)return;
  const id=meetingId,name=`${filePrefix()}-${meetingStamp}.txt`;
  saveTranscriptNow=()=>{clearTimeout(transcriptSaveTimer);saveTranscriptNow=null;storeMeetingFile(transcriptFile(),'transcript',name,id)};
  transcriptSaveTimer=setTimeout(saveTranscriptNow,800);
}
// Finalized spans go to the meeting record for the review page: at most every 10 s while the meeting
// runs, and shortly after it ends or a refinement changes a translation. Bound to their meeting too.
let segmentSaveTimer=null,saveSegmentsNow=null;
function storeSegments(){
  // Changing the language after the meeting starts a new translation pass of the same text; it must not
  // replace the meeting's stored segments (their seq would no longer match) or its language.
  if(!meetingId||translationEpoch!==meetingEpoch||(segmentSaveTimer&&stream))return;
  clearTimeout(segmentSaveTimer);
  const id=meetingId;
  saveSegmentsNow=()=>{clearTimeout(segmentSaveTimer);segmentSaveTimer=saveSegmentsNow=null;sendSegments(id)};
  segmentSaveTimer=setTimeout(saveSegmentsNow,stream?10000:800);
}
// --- Segment saving (segment-save-retry) ---
// A failed save is shown next to the status and retried with the latest segments; 401 waits for a new sign-in.
const SEGMENT_RETRY_SECONDS=[5,15,30,60];
let segmentSave={unsaved:false,failures:0,retry:null,signedOut:false,savedAt:null};
let segmentOwner='';   // the meeting whose segments the page holds; set once a new meeting has cleared the old ones
function ownSegments(id){
  clearTimeout(segmentSave.retry);segmentOwner=id;
  segmentSave={unsaved:false,failures:0,retry:null,signedOut:false,savedAt:null};showSegmentSave();
}
function showSegmentSave(){
  const state=$('saveState'),wait=SEGMENT_RETRY_SECONDS[Math.min(segmentSave.failures,SEGMENT_RETRY_SECONDS.length)-1];
  const [text,warn]=segmentSave.signedOut?['登入已失效，段落尚未儲存，請重新登入',true]
    :segmentSave.failures?[`段落尚未儲存，${wait} 秒後重試`,true]
    :segmentSave.savedAt?[`段落已儲存 ${segmentSave.savedAt.toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}`,false]:['',false];
  state.textContent=text;state.className=warn?'save-state warn':'save-state';state.hidden=!text;
}
function unsavedSegments(){return segmentSave.unsaved}
// Leaving now would lose something: the recording, a save still waiting for its timer, or segments not saved yet.
function leavingLosesData(){return Boolean(recorder||segmentSaveTimer||unsavedSegments())}
function sendSegments(id){
  if(id!==segmentOwner)return;   // another meeting has started: the page no longer holds this meeting's segments
  // With the quality pass on every segment has its own fixed seq (merged ones leave gaps); otherwise it is the position.
  const segments=outputRecords().map((s,i)=>({seq:qualityOn?s.seq:i+1,startMs:s.startMs||0,endMs:s.endMs||0,source:s.source,target:s.target,detected:s.detected||''}));
  if(!segments.length)return;
  clearTimeout(segmentSave.retry);segmentSave.retry=null;segmentSave.unsaved=true;
  fetch(`/api/meetings/${id}/segments`,{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({glossary:$('context').value.trim(),learned:learnedTerms,sourceLanguage:direction.source,targetLanguage:direction.target,segments,merged:qualityOn?quality.merged:[]})})
    .then(response=>{
      if(response.ok)window.MeetingSeries?.saved(id,segments.length);
      if(id!==segmentOwner)return;   // a late answer for the previous meeting must not change the new one's state
      if(response.status===401){segmentSave.signedOut=true;showSegmentSave();return}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      segmentSave={unsaved:false,failures:0,retry:null,signedOut:false,savedAt:new Date()};showSegmentSave();
    })
    .catch(error=>{
      console.warn('Segment save failed',error.message);
      if(id!==segmentOwner||segmentSave.signedOut)return;   // signed out: no retries until a save gets through again
      segmentSave.failures++;
      const wait=SEGMENT_RETRY_SECONDS[Math.min(segmentSave.failures,SEGMENT_RETRY_SECONDS.length)-1];
      clearTimeout(segmentSave.retry);segmentSave.retry=setTimeout(()=>sendSegments(id),wait*1000);showSegmentSave();
    });
}
// --- End segment saving ---
// The recognition connection closed. 4401 mid-meeting (signed out elsewhere): stop first, so the browser recording is
// kept for download, then say why; 4401 with no meeting running goes to the sign-in page (stream-limits).
function onSocketClose(event){
  // 即時口譯: the source text stopped, the interpreting goes on (realtime-interpret); a sign-out still ends everything.
  if(stream&&!stopping&&sessionPrefix==='interpret'&&event.code!==4401){toast(`原文辨識已停止：${closeMessage(event.code,event.reason)}（口譯照常進行）`,8000);socket=null;return}
  if(stream&&!stopping)return stopMeeting(false).then(()=>setStatus(closeMessage(event.code,event.reason),'error'));
  if(event.code===4401)location.replace(ReturnPath.loginUrl(location.pathname,location.search));
}
// Why the server closed the recognition connection; for stream limits its reason is the message to show (stream-limits).
function closeMessage(code,reason){
  if(code===4401)return '登入已失效，錄音已停止；請先下載錄音，再重新登入';
  if([4403,4408,4413,4429].includes(code)&&reason)return reason;
  return code===4404?'找不到這場會議，請重新整理後再試':'辨識連線已中斷';
}
// A quality event: keep its sentences (or, when the chunk failed, the live segments of its range) and redraw.
function onQuality(event){
  if(!qualityOn)return;
  QualityView.apply(quality,event,finalizedRecords());
  const down=QualityView.unavailable(quality);
  if(down&&!qualityDown)setStatus('精準模式暫時無法使用，已改用即時結果','error');
  else if(!down&&qualityDown)checkServices();   // back to the usual readiness status
  qualityDown=down;
  render('transcript',transcript);renderTranslation();storeSegments();
}
function updateTimer(){const sec=Math.floor((Date.now()-startedAt)/1000);$('timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function onMessage(event){
  let data; try{data=JSON.parse(event.data)}catch{return}
  if(data.status==='error'){setStatus(typeof data.msg==='string'?data.msg:'辨識服務錯誤','error');return}
  if(data.record){recordToken=data.record;return}   // 即時翻譯's record: where the translation goes while it runs
  if(data.saved){savedRecord=data.saved;return}
  if(data.quality){onQuality(data.quality);return}
  // quality-revision: sentences already kept, corrected with more context; same position, new text.
  if(data.revision){if(qualityOn&&QualityView.revise(quality,data.revision)){render('transcript',transcript);renderTranslation();storeSegments()}return}
  // The cloud engine's tentative tail: shown and drafted now, replaced when the confirming deltas arrive.
  if(typeof data.tentative==='string'&&data.tentative!==tentative){tentative=data.tentative;sourceRevision++;if(!(data.msg?.text)){render('transcript',transcript);if(pendingSource().trim())scheduleTranslation(false)}}
  const chunk=data.msg?.text||'';
  const markEnd=()=>{if(data.msg?.speech_end&&!incompleteClause(transcript))utteranceBoundaries.add(transcript.length)};
  if(!chunk){markEnd();if(data.msg?.reset&&transcript.length>translationOffset)scheduleTranslation(false);return}
  const start=transcript.length;
  sourceRevision++;
  transcript = typeof data.displayText==='string' ? data.displayText : transcript+chunk;
  // displayText can re-punctuate the current item (MAI), so the utterance ends at the new end.
  markEnd();
  languageSpans.push({start,end:transcript.length,source:data.detectedLanguage||''});
  if(Number.isFinite(data.audioMs))timeMarks.push({end:transcript.length,ms:data.audioMs});
  // ASR resets are decoding events, not proof of a complete semantic sentence.
  render('transcript',transcript); scheduleTranslation(false);
  if(interpretOn())window.InterpretMode.source(transcript);
}
// Names and mishearings learned from this meeting's own transcript, since nobody knows them beforehand.
// Each pass votes on the server; only repeated findings become translation hints.
let termPasses=[],learnedTerms='',termCheckedAt=0,termRequest=null;
function resetLearnedTerms(){termPasses=[];learnedTerms='';termCheckedAt=transcript.length;correctionQueue=[];correctedForms=new Set();$('learnedTerms').hidden=true}
function learnTerms(){
  // The model serves one request at a time; learn between translations, once per ~300 new characters.
  if(qualityOn||noTranslation()||termRequest||activeTranslation||transcript.length-termCheckedAt<300)return;   // terms only help translation
  const end=transcript.length,passes=termPasses;termCheckedAt=end;
  termRequest=fetch('/api/terms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:transcript.slice(Math.max(0,end-1500),end),source:direction.source,previous:passes.slice(-40)})})
    .then(response=>response.ok?response.json():null)
    .then(result=>{if(!result||passes!==termPasses)return;passes.push(result.found);learnedTerms=result.learned;$('learnedTerms').textContent=`自動學習詞彙：${learnedTerms.replaceAll('=',' ← ')}`;$('learnedTerms').hidden=!learnedTerms;queueCorrections(result.replaced||[])})
    .catch(()=>{}).finally(()=>{termRequest=null;correctNext()});
}
// A name is usually learned only after it was heard a few times; spans finalized before that are
// re-translated once, in the background, so the meeting record ends up consistent.
let correctionQueue=[],correctedForms=new Set(),correcting=false;
function queueCorrections(forms){
  const fresh=forms.filter(form=>!correctedForms.has(form));if(qualityOn||!fresh.length)return;
  fresh.forEach(form=>correctedForms.add(form));
  const epoch=`${translationEpoch}:`;
  for(const record of segmentRecords.values())if(record.id.startsWith(epoch)&&record.state==='finalized'&&fresh.some(form=>record.source.includes(form))&&!correctionQueue.includes(record))correctionQueue.push(record);
}
// Live finals see only the speech before them. Once the next span is final too, each span is
// re-translated in the gaps with both neighbours, so a span cut mid-clause still reads correctly.
function queueRefinement(){
  const finals=finalizedRecords(),record=finals.at(-2);
  if(qualityOn||noTranslation())return;   // the quality pass already re-translates with context; nothing to refine untranslated
  if(record&&!record.refined&&!correctionQueue.includes(record)){record.refined=true;correctionQueue.push(record)}
}
function finalizedRecords(){
  const epoch=`${translationEpoch}:`;
  return [...segmentRecords.values()].filter(s=>s.id.startsWith(epoch)&&s.state==='finalized').sort((a,b)=>a.start-b.start);
}
// 雲端精修: refinements go to the configured cloud model. Off by default; the choice stays in this browser.
function cloudRefineOn(){return !interpretOn()&&!noTranslation()&&!$('cloudRefineRow').hidden&&$('cloudRefine').checked&&!qualityChosen()}   // 精準模式 includes it
// The spoken language decides the engine (meeting-setup-layout): Chinese and the modes that may contain it stay on the
// local model, every other language uses MAI when the server offers it. Keep in step with server.asr_engine()'s 混合 rule.
const LOCAL_ENGINE_LANGUAGES=['zh','yue','auto','zh_ja'];
function engineForLanguage(language){return LOCAL_ENGINE_LANGUAGES.includes(language)?'local':'mai'}
var maiOffered=false;   // /api/config's mai: the engine follows the spoken language only when MAI is offered
function asrEngine(){return maiOffered?engineForLanguage($('language').value):'local'}   // no 辨識引擎 row (ui-night-celadon): the data destination notice says where audio goes
function showRefineFit(){$('cloudRefineFit').textContent=qualityChosen()?'精準模式已包含，不需另外開啟':'傳送文字到外部服務 · 適合辨識已正確、想要譯文更通順'}
// 團隊: every meeting belongs to one of the user's teams; the last choice stays in this browser.
const NO_TEAM='尚未加入任何團隊，請聯絡管理員';
window.accountSoon.then(({teams})=>{   // page-switching: the remembered account fills the menu at once
  let saved='';try{saved=localStorage.getItem('team')||''}catch{}
  $('team').replaceChildren(...teams.map(team=>Object.assign(document.createElement('option'),{value:team.id,textContent:team.name})));
  if(teams.some(team=>String(team.id)===saved))$('team').value=saved;
  $('team').hidden=!teams.length;$('teamHint').textContent=teams.length?'':NO_TEAM;
  showSentence();
});
$('team').onchange=()=>{try{localStorage.setItem('team',$('team').value)}catch{};showSentence()};
async function createMeeting(teamId){
  const response=await fetch('/api/meetings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({team_id:teamId,language:$('language').value,engine:asrEngine(),title:$('topic').value.trim(),series_id:window.MeetingSeries?.seriesId()??null})});
  if(response.status===401){location.replace(ReturnPath.loginUrl(location.pathname,location.search));throw new Error('請先登入')}
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法建立會議');
  return (await response.json()).id;
}
// 服務狀態 (service-status): while nothing is running, the status says whether the local services are ready. Checked on
// load, every 30 s while the tab is visible and when it comes back; a session's own status is never overwritten, and the
// message a session ends with stays until the next scheduled check.
const SERVICE_CHECK_MS=30000;let serviceTimer=0;
async function checkServices(){
  clearTimeout(serviceTimer);
  if(document.hidden)return;
  serviceTimer=setTimeout(checkServices,SERVICE_CHECK_MS);
  let state=null;
  try{const response=await fetch('/api/services');if(response.status===401)return location.replace(ReturnPath.loginUrl(location.pathname,location.search));if(response.ok)state=await response.json()}catch{}
  if(starting||stream||stopping)return;
  if(!state)return setStatus('無法連線到伺服器','error');
  const down=state.services.filter(service=>!service.ok).map(service=>service.name);
  if(!down.length)return setStatus('服務就緒','ready');
  setStatus(`${down.join('、')}服務未啟動`,'error');$('status').title='請聯絡系統管理員';
}
document.addEventListener('visibilitychange',()=>document.hidden?clearTimeout(serviceTimer):checkServices());
checkServices();
// Unknown settings (the request failed) count as external translation: the notice must never claim text stays on the host
// when it may not (privacy-notice).
// One /api/config request per load, shared with series.js (page-switching).
window.appConfig=fetch('/api/config').then(r=>r.ok?r.json():null).catch(()=>null);
window.appConfig.then(config=>config||{cloudTranslate:true}).then(({cloudRefine,mai,quality:qualityReady,cloudTranslate})=>{
  cloudTranslation=!!cloudTranslate;
  maiOffered=!!mai;$('cloudRefineRow').hidden=!cloudRefine;$('qualityRow').hidden=!qualityReady;$('setupAdvanced').hidden=!(cloudRefine||qualityReady);
  try{$('quality').checked=localStorage.getItem('quality')==='1'}catch{}
  $('cloudRefine').disabled=qualityChosen();
  try{$('cloudRefine').checked=localStorage.getItem('cloudRefine')==='1'}catch{}
  showRefineFit();showPrivacy();showAdvanced();
}).catch(()=>{});
// Where audio and text go for the current choices (privacy-notice); the header and the footer say the same.
let cloudTranslation=null;   // the translation model is an external service (cloud-translation); null until /api/config answered
function showPrivacy(){
  if(cloudTranslation===null)return;   // not known yet: the page keeps 資料去向／確認中… instead of a claim that may be false
  const note=interpretOn()?{label:'雲端口譯',sentence:'音訊會傳送到外部服務'}:PrivacyNote.text(asrEngine(),cloudRefineOn(),qualityChosen(),cloudTranslation&&!noTranslation());
  $('privacyNote').replaceChildren(Object.assign(document.createElement('b'),{textContent:note.label}),note.sentence);
  $('secureLabel').textContent=note.label;
}
$('cloudRefine').onchange=()=>{try{localStorage.setItem('cloudRefine',$('cloudRefine').checked?'1':'0')}catch{}showPrivacy()};
$('quality').onchange=()=>{try{localStorage.setItem('quality',$('quality').checked?'1':'0')}catch{}$('cloudRefine').disabled=qualityChosen();showRefineFit();showPrivacy()};
let correctionTimer=null;
async function correctNext(){
  if(noTranslation())correctionQueue.length=0;   // corrections retranslate: none without a translation
  if(correcting||!correctionQueue.length)return;
  // Live translation has priority on the single model slot; try again in the next gap.
  if(activeTranslation||termRequest){if(!correctionTimer)correctionTimer=setTimeout(()=>{correctionTimer=null;correctNext()},500);return}
  const record=correctionQueue.shift(),epoch=translationEpoch,pair=direction.source==='zh_ja';correcting=true;
  const finals=finalizedRecords(),index=finals.indexOf(record);
  const {body,neighbours}=TranslationContext.refinementRequest(finals,index,{source:direction.source,target:direction.target,
    glossary:$('context').value.trim(),learned:learnedTerms,refine:cloudRefineOn(),tail:transcript.slice(record.end,record.end+120)});
  try{
    const result=await streamTranslation(body);
    if(epoch!==translationEpoch||segmentRecords.get(record.id)!==record)return;
    if(!TranslationContext.plausibleRefinement(record.target,result.text,neighbours)){console.warn('Refinement repeated its context; kept the live translation',record.id);return}
    record.target=TranslationContext.labelled(result.text,result.source,pair);record.version++;
    translated=[...segmentRecords.values()].filter(s=>s.id.startsWith(`${epoch}:`)&&s.state==='finalized').map(s=>s.target).join('\n\n');renderTranslation();
    if(stream)storeSegments();else storeTranscript();
  }catch(error){console.warn('Correction failed',error.message)}
  finally{correcting=false;setTimeout(correctNext,300)}
}
function segmentPlan(force=false){
  let switchAt=0;
  if(direction.source==='zh_ja'){
    const first=languageSpans.find(s=>s.end>translationOffset&&s.source)?.source;
    switchAt=languageSpans.find(s=>s.start>translationOffset&&s.source&&s.source!==first)?.start||0;
  }
  return TranslationSegmentation.plan(transcript,translationOffset,utteranceBoundaries,switchAt,force,translateOnly()?'live':'meeting');   // subtitle-sized segments in 即時翻譯
}
function sentenceBoundary(){const plan=segmentPlan();return plan.final?plan.end:0;}
function scheduleTranslation(force=false){
  if(interpretOn()||!pendingSource().trim())return;   // 即時口譯: the interpreter translates, not the text model
  clearTimeout(pauseTimer);
  if(force)flushRequested=true;
  const boundary=sentenceBoundary();
  if(boundary||force){
    activeTranslation?.kind==='draft'&&activeTranslation.abort();
    if(!translationTimer)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},boundary?90:0);
    return;
  }
  // A fixed cadence, not a debounce: continuous ASR updates must never postpone the first draft.
  if(!activeTranslation&&!translationTimer&&pendingSource().length>=6)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},250);
  pauseTimer=setTimeout(()=>{pauseTimer=null;runTranslation()},1000);
}
// replay_inject.js wraps this to time every request.
async function streamTranslation(body,signal){
  if(noTranslation())return {text:'',source:direction.source};   // transcript-only: segments settle as before, untranslated
  return TranslationContext.translateStream(body,signal);
}
async function runTranslation(){
  if(activeTranslation||!pendingSource().trim())return;
  const plan=segmentPlan(flushRequested||finalizeRemaining),segmentEnd=plan.end,final=plan.final;
  // A pause mark can arrive after its sentence was already cut (MAI "…です|、しかし"); it belongs to that one.
  // A draft of the tail also covers the cloud engine's tentative text; a final never does.
  const segment=(transcript.slice(translationOffset,segmentEnd)+(!final&&segmentEnd>=transcript.length?tentative:'')).trim().replace(/^[、，,。．.！!？?；;]+\s*/u,'');
  if(!segment)return;
  // Each draft rewrites the visible line; only refresh once a meaningful chunk was added.
  const minGrowth=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment)?12:24;
  if(!final&&lastDraftSource&&segment.startsWith(lastDraftSource)&&segment.length-lastDraftSource.length<minGrowth)return;
  // The same speech, longer: the draft on screen goes along so the next one keeps its wording (smooth-subtitles).
  const shownDraft=!final&&direction.source!=='zh_ja'&&lastDraftSource&&segment.startsWith(lastDraftSource)?draftText:'';
  const epoch=translationEpoch,controller=new AbortController();controller.kind=final?'final':'draft';activeTranslation=controller;
  const requestRevision=sourceRevision;
  if(final)flushRequested=false;else lastDraftSource=segment;
  $('translateState').textContent=final?'修訂中':'暫譯中';$('translateState').className='state-chip active';
  $('translateState').removeAttribute('role');$('translateState').removeAttribute('tabindex');
  const watchdog=setTimeout(()=>{controller.timedOut=true;controller.abort()},20000);
  let mayContinue=false;
  try{
    // Keep the previous readable draft visible while translation generates the next hypothesis.
    // Token-by-token replacement made the card collapse and jump on every request.
    const pair=direction.source==='zh_ja';
    const detected=pair?(languageSpans.find(span=>span.end>translationOffset&&span.source)?.source||''):'';
    // The previous finalized spans (same direction) resolve 它/他/她, questions and hypotheticals and keep terms consistent.
    const context=translationHistory.slice(-2).filter(prior=>!pair||!detected||prior.sourceLanguage===detected);
    // A span cut at a comma is read wrongly without the words that follow it ("它沒有兩歲孩子的，｜物理知識").
    const following=final?transcript.slice(segmentEnd,segmentEnd+120).trim():'';
    const result=await streamTranslation({text:segment,source:direction.source,target:pair?'zh':direction.target,detected_language:detected,history:context.map(p=>p.source).join('\n'),history_translation:context.map(p=>p.target).join('\n'),following,glossary:$('context').value.trim(),learned:learnedTerms,draft:!final,...(shownDraft?{previous_draft:shownDraft.slice(-600)}:{})},controller.signal);
    if(epoch!==translationEpoch||activeTranslation!==controller)return;
    if(!final&&requestRevision!==sourceRevision&&sentenceBoundary()){mayContinue=true;lastDraftSource='';return}
    translationFailures=0;
    const next=pair?`[${result.source==='zh'?'中文 → 日文':'日文 → 中文'}]\n${result.text}`:result.text;
    const id=`${epoch}:${translationOffset}`,previous=segmentRecords.get(id);
    // A span starts where the previous one ended and ends at the event that completed its text.
    const startMs=finalizedRecords().at(-1)?.endMs||0,endMs=Math.max(startMs,MeetingTimeline.endMsAt(timeMarks,segmentEnd,startMs));
    segmentRecords.set(id,{id,start:translationOffset,end:segmentEnd,source:segment,target:next,detected,startMs,endMs,version:(previous?.version||0)+1,state:final?'finalized':'tentative'});
    if(final){translated=[...segmentRecords.values()].filter(s=>s.id.startsWith(`${epoch}:`)&&s.state==='finalized').map(s=>s.target).join('\n\n');translationOffset=segmentEnd;translationHistory.push({source:segment,target:result.text,sourceLanguage:result.source});draftText='';lastDraftSource='';clearTimeout(pauseTimer);renderTranslation();$('translateState').textContent='LIVE';if(!stream&&translationOffset>=transcript.trim().length)storeTranscript();storeSegments();queueRefinement();queueMicrotask(()=>{learnTerms();correctNext()})}
    else{draftText=next.replace(/\s*(?:\.{2,}|…+|～)\s*$/u,'');draftSolid=window.Subtitles?.solid(shownDraft,draftText)??draftText.length;renderTranslation();$('translateState').textContent='暫譯'}
    mayContinue=true;
  }catch(error){
    mayContinue=error.name==='AbortError'&&!controller.timedOut;
    if(!mayContinue&&epoch===translationEpoch){
      translationFailures++;
      console.warn('Translation failed',{source:direction.source,target:direction.target,offset:translationOffset,error:error.message});
      const retry=translationFailures<=2;
      $('translateState').textContent=retry?'重新連線中':'翻譯失敗 · 點此重試';$('translateState').className='state-chip error';
      if(retry){
        lastDraftSource='';if(final)flushRequested=true;
        clearTimeout(translationTimer);translationTimer=setTimeout(()=>{translationTimer=null;if(epoch===translationEpoch)runTranslation()},translationFailures*1000);
      }else{
        $('translateState').setAttribute('role','button');$('translateState').tabIndex=0;
        toast(controller.timedOut?'翻譯回應逾時，原文已保留，可點翻譯狀態重試':error.message,5000);
      }
    }
  }finally{
    clearTimeout(watchdog);
    if(activeTranslation===controller)activeTranslation=null;
    if(mayContinue&&epoch===translationEpoch&&pendingSource().trim()){
      if(final&& !controller.signal.aborted)scheduleTranslation(false);
      else if(sentenceBoundary()||flushRequested)runTranslation();
      else if(pendingSource().trim()!==lastDraftSource&&!translationTimer)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},650);
    }
  }
}
$('translateState').onclick=()=>{if($('translateState').getAttribute('role')!=='button')return;translationFailures=0;flushRequested=true;lastDraftSource='';runTranslation()};
$('translateState').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('translateState').click()}};
$('start').onclick=()=>stream?stopMeeting():startMeeting();
for(const b of document.querySelectorAll('.mode-btn'))b.onclick=()=>setLiveMode(b.dataset.mode);
let rememberedMode='meeting';try{rememberedMode=localStorage.getItem('liveMode')||'meeting'}catch{}
let rememberedTarget='';try{rememberedTarget=localStorage.getItem('meetingTarget')||''}catch{}
{
  const language=recalled('meetingLanguage');
  if(language&&$('language').querySelector(`option[value="${CSS.escape(language)}"]`))$('language').value=language;
  if(rememberedMode==='meeting'&&rememberedTarget&&$('targetLanguage').querySelector(`option[value="${CSS.escape(rememberedTarget)}"]`))$('targetLanguage').value=rememberedTarget;
}
setLiveMode(rememberedMode==='meeting'?'meeting':'translate',false);
// 即時口譯 is offered to granted users only; a disabled button explains nothing on hover, so the reason stands next to the modes.
window.InterpretMode?.ready.then(()=>{
  if(rememberedMode==='interpret'&&window.InterpretMode.usable())setLiveMode('interpret',false);
  const why=window.InterpretMode.reason();$('interpretLocked').textContent=why;$('interpretLocked').hidden=!why;
});
$('testMic').onclick=toggleMicTest;
$('audioSource').onchange=()=>{remember('audioSource',$('audioSource').value);updateSourceUI()};
// A browser that cannot share tab or system audio is set back to the microphone further down.
{const kept=recalled('audioSource');if(kept&&$('audioSource').querySelector(`option[value="${CSS.escape(kept)}"]`))$('audioSource').value=kept}
updateSourceUI();
$('microphone').onchange=()=>{micChosen=true;remember('microphoneId',$('microphone').value);remember('microphoneLabel',$('microphone').selectedOptions[0]?.textContent||'');setMicStatus('已切換，請先測試音源');showSentence()};
$('interpretPlay').addEventListener('change',showSentence);
navigator.mediaDevices?.addEventListener('devicechange',()=>refreshMicrophones());
refreshMicrophones().catch(()=>setMicStatus('無法讀取麥克風清單','error'));
$('language').onchange=()=>updateTranslationDirection(true);
$('targetLanguage').onchange=()=>updateTranslationDirection(true);
$('swap').onclick=()=>{if($('language').value==='auto')return toast('請先選擇明確的語音語言，再交換翻譯方向');const source=$('language').value;$('language').value=$('targetLanguage').value;$('targetLanguage').value=source;updateTranslationDirection(true)};
updateTranslationDirection();
$('clear').onclick=()=>location.reload();
$('download').onclick=()=>saveFile(transcriptFile(),`${filePrefix()}-${meetingStamp||new Date().toISOString().slice(0,19).replaceAll(':','-')}.txt`);
$('downloadAudio').onclick=saveRecording;
// Closing the tab mid-meeting would drop the in-memory recording.
addEventListener('beforeunload',event=>{if(leavingLosesData())event.preventDefault()});
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const value=button.dataset.copy==='transcript'?transcript:visibleTranslation();if(!value)return toast('目前沒有可複製的內容');await navigator.clipboard.writeText(value);toast('已複製到剪貼簿')});

// Reuse the same controls and reading surfaces across phone and desktop layouts.
const mobileQuery=matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px) and (pointer: coarse)');
const mobilePanels={transcript:$('transcript').closest('article'),translation:$('translation').closest('article')};
const mobileFollow={transcript:true,translation:true};
let mobileView='translation';
const mobileSettingsNodes=[$('modeRow'),$('setupMeeting'),$('teamRow'),$('topicRow'),$('seriesRow'),$('setupAudio'),$('audioSource').closest('.field'),$('microphone').closest('.field'),$('testMic'),$('sourceHint'),$('context').closest('.field'),$('interpretPlayRow'),$('setupAdvanced'),$('cloudRefineRow'),$('qualityRow')];
const movableControls=[...mobileSettingsNodes,$('start')].map(node=>{
  const anchor=document.createComment('responsive-control');node.before(anchor);return{node,anchor};
});
Object.entries(mobilePanels).forEach(([view,panel])=>panel.id=`${view}Panel`);
function setMobileView(view,focus=false){
  const current=$(mobileView);
  if(current.clientHeight)mobileFollow[mobileView]=current.classList.contains('empty')||current.scrollHeight-current.scrollTop-current.clientHeight<72;
  mobileView=view;
  document.querySelector('.transcripts').dataset.view=view;
  Object.entries(mobilePanels).forEach(([name,panel])=>{
    const selected=name===view,tab=$(`${name}Tab`);
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
    panel.inert=mobileQuery.matches&&!selected;
    if(mobileQuery.matches){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.setAttribute('aria-hidden',String(!selected))}
    else{panel.removeAttribute('role');panel.removeAttribute('aria-labelledby');panel.removeAttribute('aria-hidden')}
  });
  if(focus)$(`${view}Tab`).focus();
  if(mobileQuery.matches&&mobileFollow[view])requestAnimationFrame(()=>{$(view).scrollTop=$(view).scrollHeight});
}
// The start/end button: the phone's bottom slot; on wide windows the floating live bar during a session; else its own
// place in the setup. Always the same node, so its handler, the stop class and 結束中… move with it.
function placeStart(){
  const start=$('start'),home=movableControls.find(c=>c.node===start).anchor,focused=document.activeElement===start;
  if(mobileQuery.matches)$('mobileActionSlot').appendChild(start);
  else if(document.body.classList.contains('live-session'))$('liveActionSlot').appendChild(start);
  else home.after(start);
  if(focused&&document.activeElement!==start)start.focus({preventScroll:true});   // moving a node drops its focus
}
// body.live-session: a session on a wide layout. Phones (mobileQuery, sideways ones included) keep their own layout.
function syncLiveSession(){document.body.classList.toggle('live-session',$('liveBar').classList.contains('visible')&&!mobileQuery.matches)}
function syncMobileLayout(){
  const mobile=mobileQuery.matches;
  if(!mobile&&$('mobileSettings').open)$('mobileSettings').close();
  movableControls.forEach(({node,anchor})=>{
    if(node.id==='start')return;   // placeStart()
    if(mobile)$('mobileSettingsFields').appendChild(node);
    else anchor.after(node);
  });
  syncLiveSession();placeStart();showSentence();
  $('download').textContent=mobile?'↓ 匯出':'↓ 匯出逐字稿';
  setMobileView(mobileView);
  showAdvanced();showSetupMore();
}
// 進階 folds away on wide windows and remembers the choice (meeting-setup-layout); folded, its button names the advanced
// options in use. Folding only hides the fields: their values and what a meeting sends stay the same. Phones keep the
// settings dialog as it was, where the heading is not a fold button.
function advancedSummary(){   // the engine is not listed: the spoken language decides it, the privacy notice names it
  const parts=[];
  if(cloudRefineOn())parts.push('雲端精修');
  if(qualityChosen())parts.push('精準模式');
  return parts.join('、')||'預設';
}
let advancedOpen=false;
try{advancedOpen=localStorage.getItem('setupAdvancedOpen')==='1'}catch{}
function showAdvanced(){
  const button=$('setupAdvanced'),folding=!mobileQuery.matches;
  button.disabled=!folding;
  if(folding){button.setAttribute('aria-expanded',String(advancedOpen));button.setAttribute('aria-controls','refineGroup')}
  else{button.removeAttribute('aria-expanded');button.removeAttribute('aria-controls')}
  document.querySelector('.controls').classList.toggle('advanced-folded',folding&&!advancedOpen);
  $('advancedSummary').textContent=advancedSummary();
}
// 更多設定 (ui-setup-collapse): on wide windows the setup starts folded to the mode buttons, this button and the start
// button; the choice is remembered. Phones keep the settings dialog. Folding only hides fields, never changes them.
let setupMoreOpen=false;
try{setupMoreOpen=localStorage.getItem('setupMoreOpen')==='1'}catch{}
function showSetupMore(){
  const wide=!mobileQuery.matches,button=$('setupMore');
  button.hidden=!wide;button.setAttribute('aria-expanded',String(setupMoreOpen));
  document.querySelector('.controls').classList.toggle('setup-folded',wide&&!setupMoreOpen);
}
function setSetupMore(open){if(!open&&testStream)stopMicTest();setupMoreOpen=open;try{localStorage.setItem('setupMoreOpen',open?'1':'0')}catch{}showSetupMore()}
$('setupMore').onclick=()=>setSetupMore(!setupMoreOpen);
$('setupAdvanced').onclick=()=>{
  if(mobileQuery.matches)return;
  advancedOpen=!advancedOpen;
  try{localStorage.setItem('setupAdvancedOpen',advancedOpen?'1':'0')}catch{}
  showAdvanced();
};
['cloudRefine','quality'].forEach(id=>$(id).addEventListener('change',showAdvanced));
Object.keys(mobilePanels).forEach(view=>{
  $(`${view}Tab`).onclick=()=>setMobileView(view);
  $(`${view}Tab`).onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();setMobileView(event.key==='Home'?'transcript':event.key==='End'?'translation':mobileView==='translation'?'transcript':'translation',true);
  };
});
$('mobileSettingsOpen').onclick=()=>$('mobileSettings').showModal();
$('mobileSettingsClose').onclick=$('mobileSettingsDone').onclick=()=>$('mobileSettings').close();
$('mobileSettings').addEventListener('close',()=>{if(testStream)stopMicTest()});
// A tap on the backdrop closes the dialog: closedby="any" in index.html (light-dismiss-a-dialog); this script only where
// the browser does not know closedby yet (Safari).
if(!('closedBy' in HTMLDialogElement.prototype))$('mobileSettings').addEventListener('click',event=>{if(event.target!==$('mobileSettings'))return;const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close()});
mobileQuery.addEventListener('change',syncMobileLayout);
if(!navigator.mediaDevices?.getDisplayMedia){
  [...$('audioSource').options].filter(option=>option.value!=='microphone').forEach(option=>{option.disabled=true;option.textContent+='（此瀏覽器不支援）'});
  $('audioSource').value='microphone';updateSourceUI();
}
syncMobileLayout();
