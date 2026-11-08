const $ = (id) => document.getElementById(id);
const EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS';
const translationEmptyMarkup = $('translation').innerHTML;
let socket, stream, captureStreams = [], audioContext, sourceNodes = [], workletNode, startedAt, timerHandle, starting = false, stopping = false;
let recorder, recordingChunks = [], recording, meetingStamp = '', meetingId = '', meetingEpoch = -1, topicUsed = false, sessionPrefix = '';
let testStream, testStreams = [], testAudioContext, testSources = [], testAnalyser, testAnimation;
let transcript = '', translated = '', draftText = '', translationTimer, pauseTimer, activeTranslation;
let translationOffset = 0, translationHistory = [], translationEpoch = 0, flushRequested = false, lastDraftSource = '';
let translationFinalNode, translationDraftNode;
let direction = { source: 'auto', target: 'en' };
const languageTags = {auto:'AUTO',zh_ja:'中⇄日',zh:'中',en:'EN',ja:'日',ko:'한',fr:'FR',de:'DE',it:'IT',pt:'PT',ru:'RU',es:'ES',ar:'AR'};
const languageSpans=[],utteranceBoundaries=new Set();
// Gateway audio clock (audioMs) at each transcript length, so finalized spans know their place in the recording.
const timeMarks=[];
let fixedTarget='en';
let translationFailures=0;
const segmentRecords=new Map();
let finalizeRemaining=false,sourceRevision=0;
const incompleteClause=s=>TranslationSegmentation.unfinished(s);
const startButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始會議</b><small>即時轉錄與翻譯</small></span>';
const stopButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束會議</b><small>儲存這次記錄</small></span>';
const translateStartContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始翻譯</b><small>即時轉錄與翻譯</small></span>';
const translateStopContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束翻譯</b><small>不會存到伺服器</small></span>';
// 即時翻譯 (live-translation): the same page without a meeting record; nothing is kept on the server.
function translateOnly(){return document.body.classList.contains('translate-mode')}
function filePrefix(){return sessionPrefix||(translateOnly()?'translate':'meeting')}   // the mode the session ran in, not the switch now
function setLiveMode(mode,persist=true){
  if(stream||starting)return;
  const translate=mode==='translate';
  document.body.classList.toggle('translate-mode',translate);document.querySelector('.controls').classList.toggle('translate',translate);
  for(const b of document.querySelectorAll('.mode-btn'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
  $('modeNote').textContent=translate?'不建立會議紀錄；逐字稿與錄音只留在瀏覽器，可按「匯出」下載':'建立會議紀錄，會後可校對、產生紀要';
  $('start').innerHTML=translate?translateStartContent:startButtonContent;
  $('storeNote').textContent=translate?'不存到伺服器，可按匯出下載':'錄音與逐字稿存於 output 資料夾';
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
function render(id, value) { if(id==='transcript')window.Subtitles?.update({source:value}); const el=$(id),follow=el.classList.contains('empty')||el.scrollHeight-el.scrollTop-el.clientHeight<72; el.textContent=value; el.classList.toggle('empty', !value); updateCounts(); if(value&&follow) el.scrollTop=el.scrollHeight; }
function visibleTranslation(){return translated+(translated&&draftText?'\n':'')+draftText}
function renderTranslation(){
  window.Subtitles?.update({translation:translated,draft:draftText});   // the floating subtitles (live-translation)
  const el=$('translation'),wasEmpty=el.classList.contains('empty');
  const follow=wasEmpty||el.scrollHeight-el.scrollTop-el.clientHeight<72;
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
    if(translationDraftNode.textContent!==draftText)translationDraftNode.textContent=draftText;
  }else if(translationDraftNode){translationDraftNode.remove();translationDraftNode=null}
  updateCounts();if(follow)el.scrollTop=el.scrollHeight;
}
function updateCounts(){ $('transcriptCount').textContent=`${transcript.length.toLocaleString()} 字`; $('translationCount').textContent=`${visibleTranslation().length.toLocaleString()} 字`; }
function toast(message,duration=2200){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),duration)}
function setControls(active){for(const b of document.querySelectorAll('.mode-btn'))b.disabled=active;const pair=direction.source==='zh_ja';$('language').disabled=active;$('targetLanguage').disabled=active||pair;$('audioSource').disabled=active;$('microphone').disabled=active;$('testMic').disabled=active;$('context').disabled=active;$('asrEngine').disabled=active;$('team').disabled=active;$('topic').disabled=active;window.MeetingSeries?.lock(active);$('cloudRefine').disabled=active;$('swap').disabled=active||pair;$('liveBar').classList.toggle('visible',active);$('liveBar').setAttribute('aria-hidden',String(!active))}
function updateTranslationDirection(){
  const pair=$('language').value==='zh_ja';
  if(pair){if($('targetLanguage').value!=='zh_ja')fixedTarget=$('targetLanguage').value;$('targetLanguage').value='zh_ja'}
  else if($('targetLanguage').value==='zh_ja')$('targetLanguage').value=fixedTarget;
  $('targetLanguage').disabled=Boolean(stream)||pair;$('swap').disabled=Boolean(stream)||pair;
  direction={source:$('language').value,target:$('targetLanguage').value};
  if(!pair&&direction.source===direction.target){$('targetLanguage').value=direction.source==='en'?'zh':'en';direction.target=$('targetLanguage').value}
  translationEpoch++;activeTranslation?.abort();activeTranslation=null;clearTimeout(translationTimer);clearTimeout(pauseTimer);translated='';draftText='';translationOffset=0;translationHistory=[];flushRequested=false;lastDraftSource='';translationFailures=0;renderTranslation();
  const tags=$('swap').querySelectorAll('.lang-tag');tags[0].textContent=languageTags[direction.source]||direction.source.toUpperCase();tags[1].textContent=languageTags[direction.target]||direction.target.toUpperCase();
  $('targetLabel').textContent=pair?'中日雙向翻譯':`翻譯成 ${$('targetLanguage').selectedOptions[0].textContent}`;
  $('targetLabel').closest('.card-title').querySelector('.language-dot').textContent=languageTags[direction.target]||direction.target.toUpperCase();
  $('translateState').textContent='READY';$('translateState').className='state-chip';
  if(transcript)scheduleTranslation(true);
}
function selectedSource(){return $('audioSource').value}
function updateSourceUI(){const mode=selectedSource(),system=mode!=='microphone';$('microphone').closest('.mic-field').classList.toggle('is-hidden',mode==='system');$('sourceHint').textContent=system?'點「測試音源」或「開始會議」後，在 Chrome 分享視窗勾選「分享分頁音訊」或「分享系統音訊」。只選畫面、不分享音訊，無法轉錄。'+(mode==='mixed'?'混合模式也會收取麥克風；建議使用耳機。':''):'使用耳機開會可避免喇叭聲被麥克風重複收進來。';$('testMic').querySelector('small').textContent=system?'開啟分享選擇器':'確認有聲音';if(!testStream)setMicStatus(system?'尚未連接分享音訊':'尚未測試音源')}
function audioConstraints(){const selected=$('microphone').value;return{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(selected&&selected!=='default'?{deviceId:{exact:selected}}:{})}}
function setMicStatus(text,kind=''){$('micStatus').textContent=text;$('micStatus').className=kind}
async function microphonePermission(){try{return(await navigator.permissions.query({name:'microphone'})).state}catch{return'unknown'}}
async function requestMicrophone(){
  let expired=false,timer;
  const request=navigator.mediaDevices.getUserMedia({audio:audioConstraints()});
  request.then(result=>{if(expired)result.getTracks().forEach(track=>track.stop())}).catch(()=>{});
  try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new DOMException('請在 Chrome 網址列允許此網站使用麥克風','NotAllowedError'))},10000)})])}finally{clearTimeout(timer)}
}
async function requestDisplayAudio(){
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
async function refreshMicrophones(preferredId=''){
  if(!navigator.mediaDevices?.enumerateDevices){setMicStatus('瀏覽器不支援裝置選擇','error');return}
  const permission=await microphonePermission();
  if(permission==='denied')setMicStatus('Chrome 已封鎖麥克風，請在網址列解除','error');
  else if(permission==='prompt')setMicStatus('請先按「測試音源」並允許麥克風');
  const current=preferredId||$('microphone').value;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  $('microphone').innerHTML='';
  devices.forEach((device,index)=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label||`麥克風 ${index+1}`;$('microphone').appendChild(option)});
  if(!devices.length){const option=document.createElement('option');option.value='default';option.textContent='找不到麥克風';$('microphone').appendChild(option);setMicStatus('沒有可用的輸入裝置','error');return}
  if([...$('microphone').options].some(o=>o.value===current))$('microphone').value=current;
}
function stopMicTest(){cancelAnimationFrame(testAnimation);testSources.forEach(source=>source.disconnect());testStreams.forEach(media=>media.getTracks().forEach(track=>track.stop()));testAudioContext?.close();testStream=testAudioContext=testAnalyser=null;testStreams=[];testSources=[];$('testMic').classList.remove('testing');$('testMic').querySelector('b').textContent='測試音源';$('microphone').disabled=false;$('audioSource').disabled=false;$('micTestLevel').style.transform='scaleX(.03)';updateSourceUI()}
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
    const draw=()=>{testAnalyser.getFloatTimeDomainData(samples);let sum=0;for(const value of samples)sum+=value*value;const rms=Math.sqrt(sum/samples.length),level=Math.min(1,rms*8);peak=Math.max(level,peak*.94);$('micTestLevel').style.transform=`scaleX(${Math.max(.03,peak)})`;if(peak>.08)setMicStatus(`訊號正常：${label}`,'ok');testAnimation=requestAnimationFrame(draw)};draw();
    $('testMic').classList.add('testing');$('testMic').querySelector('b').textContent='結束測試';$('testMic').querySelector('small').textContent=selectedSource()==='microphone'?'請對麥克風說話':'請播放影片或會議音訊';$('microphone').disabled=true;$('audioSource').disabled=true;$('testMic').disabled=false;
    testStreams.forEach(media=>media.getTracks().forEach(mediaTrack=>mediaTrack.onended=()=>{stopMicTest();setMicStatus('音源已中斷','error')}));
  }catch(error){stopMicTest();setMicStatus(error.name==='NotAllowedError'?(error.message||'Chrome 未允許麥克風'):'無法連接所選音源','error');toast(error.message)}finally{$('testMic').disabled=false}
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
    if(selectedSource()==='microphone')await refreshMicrophones(stream.getAudioTracks()[0].getSettings().deviceId);
    captureStreams.forEach(media=>media.getTracks().forEach(track=>track.onended=()=>{if(stream && !stopping){stopMeeting(false).then(()=>{setStatus('分享或麥克風已停止','error');setMicStatus('音源已中斷','error')})}}));
    setStatus('正在連線…');
    sessionPrefix=translate?'translate':'meeting';
    if(translate)meetingId='';else{meetingId=await createMeeting(teamId);topicUsed=true;window.MeetingSeries?.started(meetingId)}
    resetMeetingState();
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws/transcribe`);
    socket.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=()=>reject(new Error('WebSocket 連線失敗')); });
    socket.send(JSON.stringify({requestId:crypto.randomUUID(),meeting_id:meetingId,mode:translate?'translate':'meeting',language:$('language').value,use_vad:direction.source==='zh_ja',system_prompt:$('context').value,engine:asrEngine(),refine:cloudRefineOn()}));
    socket.onmessage = onMessage;
    socket.onclose = event => { if(event.code===4401)return location.replace('/login'); if (stream && !stopping) stopMeeting(false).then(()=>setStatus(event.code===4404?'找不到這場會議，請重新整理後再試':'辨識連線已中斷','error')); };

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule('/assets/pcm-worklet.js?v=20261108a');
    workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
    workletNode.port.onmessage = ({data}) => { let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];$('level').style.transform=`scaleX(${Math.min(1,Math.sqrt(sum/data.length)*5+.03)})`;if(socket?.readyState===WebSocket.OPEN)socket.send(floatToPCM16(resampleTo16k(data,audioContext.sampleRate)).buffer); };
    for(const media of captureStreams){const node=audioContext.createMediaStreamSource(media),gain=audioContext.createGain();gain.gain.value=captureStreams.length>1?0.5:1;node.connect(gain).connect(workletNode);sourceNodes.push(node,gain)}
    startRecording(sourceNodes.filter((_,i)=>i%2));
    const silent=audioContext.createGain();silent.gain.value=0;workletNode.connect(silent).connect(audioContext.destination);sourceNodes.push(silent);
    await audioContext.resume();
    startedAt=Date.now(); timerHandle=setInterval(updateTimer,1000); updateTimer();
    $('start').innerHTML=translate?translateStopContent:stopButtonContent; $('start').classList.add('stop'); setControls(true); setStatus(translate?'即時翻譯中':'即時轉錄中','live');
  } catch (error) { await stopMeeting(false);setStatus(error.message,'error');setMicStatus(error.message,'error');toast(error.message,5000); }
  finally{starting=false;$('start').disabled=false}
}

async function stopMeeting(sendEos=true) {
  if(stopping)return;stopping=true;
  await stopRecording().catch(error=>toast(`錄音儲存失敗：${error.message}`,5000));
  workletNode?.disconnect();sourceNodes.forEach(node=>{try{node.disconnect()}catch{}});
  if(workletNode)workletNode.port.onmessage=null;
  if(sendEos && socket?.readyState===WebSocket.OPEN) {
    const closingSocket=socket;
    await new Promise(resolve=>{const timer=setTimeout(()=>{closingSocket.removeEventListener('close',done);toast('辨識收尾逾時，請核對最後一句',5000);resolve()},20000);function done(){clearTimeout(timer);resolve()}closingSocket.addEventListener('close',done,{once:true});closingSocket.send(EOS)});
  }
  finalizeRemaining=true;
  try{socket?.close();}catch{} captureStreams.forEach(media=>media.getTracks().forEach(track=>{track.onended=null;track.stop()}));
  try{sourceNodes.forEach(node=>node.disconnect());workletNode?.disconnect();await audioContext?.close();}catch{}
  socket=stream=audioContext=null;captureStreams=[];sourceNodes=[];workletNode=null;clearInterval(timerHandle);$('start').innerHTML=translateOnly()?translateStartContent:startButtonContent;$('start').classList.remove('stop');setControls(false);if(topicUsed){$('topic').value='';topicUsed=false}setMicStatus(`已確認：${$('activeMic').textContent}`,'ok');setStatus(transcript?(translateOnly()?'翻譯已結束；未存到伺服器，可按「匯出」下載':'會議已結束'):'系統待機');scheduleTranslation(true);storeTranscript();if(meetingId)window.MeetingSeries?.ended(meetingId);stopping=false;
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
// Each meeting's audio and transcript are written to the project's output/ folder for later review;
// if the server cannot store them, the browser download keeps them from being lost.
async function storeMeetingFile(blob,kind,name,id=meetingId){
  if(!id&&translateOnly())return;   // 即時翻譯: the file stays in the browser (download only)
  try{if(!id)throw new Error('沒有會議編號');const response=await fetch(`/api/meetings/${id}/files/${kind}`,{method:'PUT',headers:{'content-type':blob.type||'application/octet-stream'},body:blob});if(!response.ok)throw new Error((await response.json()).detail||response.status);toast(`已儲存 ${(await response.json()).saved}`,3000)}
  catch(error){toast(`無法存到 output（${error.message}），改為下載`,5000);saveFile(blob,name)}
}
function transcriptFile(){
  const pairs=[...segmentRecords.values()].filter(s=>s.state==='finalized').map((s,i)=>`[${i+1}] ${s.source}\n→ ${s.target}`).join('\n\n');
  const learned=learnedTerms?`\n\n自動學習詞彙\n${learnedTerms}`:'';
  return new Blob([`原文\n${transcript}\n\n翻譯\n${visibleTranslation()}\n\n逐段對照\n${pairs}${learned}\n`],{type:'text/plain;charset=utf-8'});
}
let transcriptSaveTimer,saveTranscriptNow=null;
// A new meeting starts empty: the previous one's text, translations and terms belong to its own
// meeting (maybe another team) and must never be saved into the new meeting's transcript.
function resetMeetingState(){
  saveTranscriptNow?.();saveSegmentsNow?.();
  transcript='';sourceRevision=0;finalizeRemaining=false;
  segmentRecords.clear();languageSpans.length=0;utteranceBoundaries.clear();timeMarks.length=0;
  updateTranslationDirection();meetingEpoch=translationEpoch;resetLearnedTerms();render('transcript','');
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
function sendSegments(id){
  const segments=finalizedRecords().map((s,i)=>({seq:i+1,startMs:s.startMs||0,endMs:s.endMs||0,source:s.source,target:s.target,detected:s.detected||''}));
  if(!segments.length)return;
  fetch(`/api/meetings/${id}/segments`,{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({glossary:$('context').value.trim(),learned:learnedTerms,sourceLanguage:direction.source,targetLanguage:direction.target,segments})})
    .then(response=>{if(!response.ok)console.warn('Segment save failed',response.status);else window.MeetingSeries?.saved(id,segments.length)}).catch(error=>console.warn('Segment save failed',error.message));
}
function updateTimer(){const sec=Math.floor((Date.now()-startedAt)/1000);$('timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function onMessage(event){
  let data; try{data=JSON.parse(event.data)}catch{return}
  if(data.status==='error'){setStatus(typeof data.msg==='string'?data.msg:'辨識服務錯誤','error');return}
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
}
// Names and mishearings learned from this meeting's own transcript, since nobody knows them beforehand.
// Each pass votes on the server; only repeated findings become translation hints.
let termPasses=[],learnedTerms='',termCheckedAt=0,termRequest=null;
function resetLearnedTerms(){termPasses=[];learnedTerms='';termCheckedAt=transcript.length;correctionQueue=[];correctedForms=new Set();$('learnedTerms').hidden=true}
function learnTerms(){
  // The model serves one request at a time; learn between translations, once per ~300 new characters.
  if(termRequest||activeTranslation||transcript.length-termCheckedAt<300)return;
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
  const fresh=forms.filter(form=>!correctedForms.has(form));if(!fresh.length)return;
  fresh.forEach(form=>correctedForms.add(form));
  const epoch=`${translationEpoch}:`;
  for(const record of segmentRecords.values())if(record.id.startsWith(epoch)&&record.state==='finalized'&&fresh.some(form=>record.source.includes(form))&&!correctionQueue.includes(record))correctionQueue.push(record);
}
// Live finals see only the speech before them. Once the next span is final too, each span is
// re-translated in the gaps with both neighbours, so a span cut mid-clause still reads correctly.
function queueRefinement(){
  const finals=finalizedRecords(),record=finals.at(-2);
  if(record&&!record.refined&&!correctionQueue.includes(record)){record.refined=true;correctionQueue.push(record)}
}
function finalizedRecords(){
  const epoch=`${translationEpoch}:`;
  return [...segmentRecords.values()].filter(s=>s.id.startsWith(epoch)&&s.state==='finalized').sort((a,b)=>a.start-b.start);
}
// 雲端精修: refinements go to the configured cloud model. Off by default; the choice stays in this browser.
function cloudRefineOn(){return !$('cloudRefineRow').hidden&&$('cloudRefine').checked}
// 辨識引擎: local Confucius, Azure MAI, or MAI for every language except Chinese. Shown only when MAI is configured.
function asrEngine(){return $('asrEngineRow').hidden?'local':$('asrEngine').value}
// 團隊: every meeting belongs to one of the user's teams; the last choice stays in this browser.
const NO_TEAM='尚未加入任何團隊，請聯絡管理員';
window.accountReady.then(({teams})=>{
  let saved='';try{saved=localStorage.getItem('team')||''}catch{}
  $('team').replaceChildren(...teams.map(team=>Object.assign(document.createElement('option'),{value:team.id,textContent:team.name})));
  if(teams.some(team=>String(team.id)===saved))$('team').value=saved;
  $('team').hidden=!teams.length;$('teamHint').textContent=teams.length?'':NO_TEAM;
});
$('team').onchange=()=>{try{localStorage.setItem('team',$('team').value)}catch{}};
async function createMeeting(teamId){
  const response=await fetch('/api/meetings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({team_id:teamId,language:$('language').value,engine:asrEngine(),title:$('topic').value.trim(),series_id:window.MeetingSeries?.seriesId()??null})});
  if(response.status===401){location.replace('/login');throw new Error('請先登入')}
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||'無法建立會議');
  return (await response.json()).id;
}
fetch('/api/config').then(r=>r.ok?r.json():{}).then(({cloudRefine,mai})=>{
  $('cloudRefineRow').hidden=!cloudRefine;$('asrEngineRow').hidden=!mai;$('setupAdvanced').hidden=!(cloudRefine||mai);
  try{$('cloudRefine').checked=localStorage.getItem('cloudRefine')==='1';const engine=localStorage.getItem('asrEngine');if([...$('asrEngine').options].some(o=>o.value===engine))$('asrEngine').value=engine}catch{}
}).catch(()=>{});
$('cloudRefine').onchange=()=>{try{localStorage.setItem('cloudRefine',$('cloudRefine').checked?'1':'0')}catch{}};
$('asrEngine').onchange=()=>{try{localStorage.setItem('asrEngine',$('asrEngine').value)}catch{}};
let correctionTimer=null;
async function correctNext(){
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
  return TranslationSegmentation.plan(transcript,translationOffset,utteranceBoundaries,switchAt,force);
}
function sentenceBoundary(){const plan=segmentPlan();return plan.final?plan.end:0;}
function scheduleTranslation(force=false){
  if(transcript.length<=translationOffset)return;
  clearTimeout(pauseTimer);
  if(force)flushRequested=true;
  const boundary=sentenceBoundary();
  if(boundary||force){
    activeTranslation?.kind==='draft'&&activeTranslation.abort();
    if(!translationTimer)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},boundary?90:0);
    return;
  }
  // A fixed cadence, not a debounce: continuous ASR updates must never postpone the first draft.
  if(!activeTranslation&&!translationTimer&&transcript.length-translationOffset>=6)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},250);
  pauseTimer=setTimeout(()=>{pauseTimer=null;runTranslation()},1000);
}
// replay_inject.js wraps this to time every request.
async function streamTranslation(body,signal){return TranslationContext.translateStream(body,signal)}
async function runTranslation(){
  if(activeTranslation||transcript.length<=translationOffset)return;
  const plan=segmentPlan(flushRequested||finalizeRemaining),segmentEnd=plan.end,final=plan.final;
  // A pause mark can arrive after its sentence was already cut (MAI "…です|、しかし"); it belongs to that one.
  const segment=transcript.slice(translationOffset,segmentEnd).trim().replace(/^[、，,。．.！!？?；;]+\s*/u,'');
  if(!segment)return;
  // Each draft rewrites the visible line; only refresh once a meaningful chunk was added.
  const minGrowth=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment)?12:24;
  if(!final&&lastDraftSource&&segment.startsWith(lastDraftSource)&&segment.length-lastDraftSource.length<minGrowth)return;
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
    const result=await streamTranslation({text:segment,source:direction.source,target:pair?'zh':direction.target,detected_language:detected,history:context.map(p=>p.source).join('\n'),history_translation:context.map(p=>p.target).join('\n'),following,glossary:$('context').value.trim(),learned:learnedTerms,draft:!final},controller.signal);
    if(epoch!==translationEpoch||activeTranslation!==controller)return;
    if(!final&&requestRevision!==sourceRevision&&sentenceBoundary()){mayContinue=true;lastDraftSource='';return}
    translationFailures=0;
    const next=pair?`[${result.source==='zh'?'中文 → 日文':'日文 → 中文'}]\n${result.text}`:result.text;
    const id=`${epoch}:${translationOffset}`,previous=segmentRecords.get(id);
    // A span starts where the previous one ended and ends at the event that completed its text.
    const startMs=finalizedRecords().at(-1)?.endMs||0,endMs=Math.max(startMs,MeetingTimeline.endMsAt(timeMarks,segmentEnd,startMs));
    segmentRecords.set(id,{id,start:translationOffset,end:segmentEnd,source:segment,target:next,detected,startMs,endMs,version:(previous?.version||0)+1,state:final?'finalized':'tentative'});
    if(final){translated=[...segmentRecords.values()].filter(s=>s.id.startsWith(`${epoch}:`)&&s.state==='finalized').map(s=>s.target).join('\n\n');translationOffset=segmentEnd;translationHistory.push({source:segment,target:result.text,sourceLanguage:result.source});draftText='';lastDraftSource='';clearTimeout(pauseTimer);renderTranslation();$('translateState').textContent='LIVE';if(!stream&&translationOffset>=transcript.trim().length)storeTranscript();storeSegments();queueRefinement();queueMicrotask(()=>{learnTerms();correctNext()})}
    else{draftText=next.replace(/\s*(?:\.{2,}|…+|～)\s*$/u,'');renderTranslation();$('translateState').textContent='暫譯'}
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
    if(mayContinue&&epoch===translationEpoch&&transcript.length>translationOffset){
      if(final&& !controller.signal.aborted)scheduleTranslation(false);
      else if(sentenceBoundary()||flushRequested)runTranslation();
      else if(transcript.slice(translationOffset).trim()!==lastDraftSource&&!translationTimer)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},650);
    }
  }
}
$('translateState').onclick=()=>{if($('translateState').getAttribute('role')!=='button')return;translationFailures=0;flushRequested=true;lastDraftSource='';runTranslation()};
$('translateState').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('translateState').click()}};
$('start').onclick=()=>stream?stopMeeting():startMeeting();
for(const b of document.querySelectorAll('.mode-btn'))b.onclick=()=>setLiveMode(b.dataset.mode);
try{setLiveMode(localStorage.getItem('liveMode')==='translate'?'translate':'meeting',false)}catch{setLiveMode('meeting',false)}
$('testMic').onclick=toggleMicTest;
$('audioSource').onchange=updateSourceUI;
updateSourceUI();
$('microphone').onchange=()=>setMicStatus('已切換，請先測試音源');
navigator.mediaDevices?.addEventListener('devicechange',()=>refreshMicrophones());
refreshMicrophones().catch(()=>setMicStatus('無法讀取麥克風清單','error'));
$('language').onchange=updateTranslationDirection;
$('targetLanguage').onchange=updateTranslationDirection;
$('swap').onclick=()=>{if($('language').value==='auto')return toast('請先選擇明確的語音語言，再交換翻譯方向');const source=$('language').value;$('language').value=$('targetLanguage').value;$('targetLanguage').value=source;updateTranslationDirection()};
updateTranslationDirection();
$('clear').onclick=()=>location.reload();
$('download').onclick=()=>saveFile(transcriptFile(),`${filePrefix()}-${meetingStamp||new Date().toISOString().slice(0,19).replaceAll(':','-')}.txt`);
$('downloadAudio').onclick=saveRecording;
// Closing the tab mid-meeting would drop the in-memory recording.
addEventListener('beforeunload',event=>{if(recorder)event.preventDefault()});
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const value=button.dataset.copy==='transcript'?transcript:visibleTranslation();if(!value)return toast('目前沒有可複製的內容');await navigator.clipboard.writeText(value);toast('已複製到剪貼簿')});

// Reuse the same controls and reading surfaces across phone and desktop layouts.
const mobileQuery=matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px) and (pointer: coarse)');
const mobilePanels={transcript:$('transcript').closest('article'),translation:$('translation').closest('article')};
const mobileFollow={transcript:true,translation:true};
let mobileView='translation';
const mobileSettingsNodes=[$('modeRow'),$('setupMeeting'),$('teamRow'),$('topicRow'),$('seriesRow'),$('setupAudio'),$('audioSource').closest('.field'),$('microphone').closest('.field'),$('testMic'),$('sourceHint'),$('context').closest('.field'),$('setupAdvanced'),$('asrEngineRow'),$('cloudRefineRow')];
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
function syncMobileLayout(){
  const mobile=mobileQuery.matches;
  if(!mobile&&$('mobileSettings').open)$('mobileSettings').close();
  movableControls.forEach(({node,anchor})=>{
    if(mobile)(node.id==='start'?$('mobileActionSlot'):$('mobileSettingsFields')).appendChild(node);
    else anchor.after(node);
  });
  $('download').textContent=mobile?'↓ 匯出':'↓ 匯出逐字稿';
  setMobileView(mobileView);
}
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
$('mobileSettings').addEventListener('click',event=>{if(event.target!==$('mobileSettings'))return;const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close()});
mobileQuery.addEventListener('change',syncMobileLayout);
if(!navigator.mediaDevices?.getDisplayMedia){
  [...$('audioSource').options].filter(option=>option.value!=='microphone').forEach(option=>{option.disabled=true;option.textContent+='（此瀏覽器不支援）'});
  $('audioSource').value='microphone';updateSourceUI();
}
syncMobileLayout();
