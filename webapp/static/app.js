const $ = (id) => document.getElementById(id);
const EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS';
const translationEmptyMarkup = $('translation').innerHTML;
let socket, stream, captureStreams = [], audioContext, sourceNodes = [], workletNode, startedAt, timerHandle, starting = false, stopping = false;
let testStream, testStreams = [], testAudioContext, testSources = [], testAnalyser, testAnimation;
let transcript = '', translated = '', draftText = '', translationTimer, pauseTimer, activeTranslation;
let translationOffset = 0, translationHistory = [], translationEpoch = 0, flushRequested = false, lastDraftSource = '';
let translationFinalNode, translationDraftNode;
let direction = { source: 'auto', target: 'en' };
const languageTags = {auto:'AUTO',zh:'中',en:'EN',ja:'日',ko:'한',fr:'FR',de:'DE',it:'IT',pt:'PT',ru:'RU',es:'ES',ar:'AR'};
const startButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>開始會議</b><small>即時轉錄與翻譯</small></span>';
const stopButtonContent = '<span class="record-icon"><i></i></span><span class="button-copy"><b>結束會議</b><small>儲存這次記錄</small></span>';
for (let i=0; i<14; i++) $('wave').appendChild(document.createElement('i'));

function applyTheme(theme, persist=true){
  const selected=theme==='light'?'light':'dark',light=selected==='light';
  document.documentElement.dataset.theme=selected;
  const button=$('themeToggle');
  button.setAttribute('aria-pressed',String(light));
  button.setAttribute('aria-label',light?'切換至暗色主題':'切換至明亮主題');
  button.title=light?'切換至暗色主題':'切換至明亮主題';
  button.querySelector('.theme-label').textContent=light?'暗色':'明亮';
  $('themeColor').content=light?'#e6dfd1':'#0b0e0d';
  if(persist){try{localStorage.setItem('interpreter-theme',selected)}catch{}}
}
let savedTheme='dark';
try{savedTheme=localStorage.getItem('interpreter-theme')==='light'?'light':'dark'}catch{}
applyTheme(savedTheme,false);
$('themeToggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');

function setStatus(text, kind='idle') { $('status').className = `status ${kind}`; $('status').querySelector('span').textContent = text; }
function render(id, value) { const el=$(id); el.textContent=value; el.classList.toggle('empty', !value); updateCounts(); if(value) el.scrollTop=el.scrollHeight; }
function visibleTranslation(){return translated+(translated&&draftText?'\n':'')+draftText}
function renderTranslation(){
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
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),1800)}
function setControls(active){$('language').disabled=active;$('targetLanguage').disabled=active;$('audioSource').disabled=active;$('microphone').disabled=active;$('testMic').disabled=active;$('context').disabled=active;$('swap').disabled=active;$('liveBar').classList.toggle('visible',active);$('liveBar').setAttribute('aria-hidden',String(!active))}
function updateTranslationDirection(){
  direction={source:$('language').value,target:$('targetLanguage').value};
  if(direction.source===direction.target){$('targetLanguage').value=direction.source==='en'?'zh':'en';direction.target=$('targetLanguage').value}
  translationEpoch++;activeTranslation?.abort();activeTranslation=null;clearTimeout(translationTimer);clearTimeout(pauseTimer);translated='';draftText='';translationOffset=0;translationHistory=[];flushRequested=false;lastDraftSource='';renderTranslation();
  const tags=$('swap').querySelectorAll('.lang-tag');tags[0].textContent=languageTags[direction.source]||direction.source.toUpperCase();tags[1].textContent=languageTags[direction.target]||direction.target.toUpperCase();
  $('targetLabel').textContent=`翻譯成 ${$('targetLanguage').selectedOptions[0].textContent}`;
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
  starting=true;$('start').disabled=true;
  try {
    if(testStream)stopMicTest();setStatus('正在檢查音源…');
    captureStreams = await acquireAudio();stream=captureStreams[0];
    const label=streamLabel(captureStreams);$('activeMic').textContent=label;setMicStatus(`使用中：${label}`,'ok');
    if(selectedSource()==='microphone')await refreshMicrophones(stream.getAudioTracks()[0].getSettings().deviceId);
    captureStreams.forEach(media=>media.getTracks().forEach(track=>track.onended=()=>{if(stream && !stopping){stopMeeting(false).then(()=>{setStatus('分享或麥克風已停止','error');setMicStatus('音源已中斷','error')})}}));
    setStatus('正在連線…');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws/transcribe`);
    socket.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=()=>reject(new Error('WebSocket 連線失敗')); });
    socket.send(JSON.stringify({requestId:crypto.randomUUID(),language:$('language').value,use_vad:false,system_prompt:$('context').value}));
    socket.onmessage = onMessage;
    socket.onclose = () => { if (stream && !stopping) stopMeeting(false).then(()=>setStatus('辨識連線已中斷','error')); };

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule('/assets/pcm-worklet.js');
    workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
    workletNode.port.onmessage = ({data}) => { let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];$('level').style.transform=`scaleX(${Math.min(1,Math.sqrt(sum/data.length)*5+.03)})`;if(socket?.readyState===WebSocket.OPEN)socket.send(floatToPCM16(resampleTo16k(data,audioContext.sampleRate)).buffer); };
    for(const media of captureStreams){const node=audioContext.createMediaStreamSource(media),gain=audioContext.createGain();gain.gain.value=captureStreams.length>1?0.5:1;node.connect(gain).connect(workletNode);sourceNodes.push(node,gain)}
    const silent=audioContext.createGain();silent.gain.value=0;workletNode.connect(silent).connect(audioContext.destination);sourceNodes.push(silent);
    await audioContext.resume();
    startedAt=Date.now(); timerHandle=setInterval(updateTimer,1000); updateTimer();
    $('start').innerHTML=stopButtonContent; $('start').classList.add('stop'); setControls(true); setStatus('即時轉錄中','live');
  } catch (error) { await stopMeeting(false);setStatus(error.message,'error');setMicStatus(error.message,'error'); }
  finally{starting=false;$('start').disabled=false}
}

async function stopMeeting(sendEos=true) {
  if(stopping)return;stopping=true;
  if(sendEos && socket?.readyState===WebSocket.OPEN) { socket.send(EOS); await new Promise(r=>setTimeout(r,700)); }
  try{socket?.close();}catch{} captureStreams.forEach(media=>media.getTracks().forEach(track=>{track.onended=null;track.stop()}));
  try{sourceNodes.forEach(node=>node.disconnect());workletNode?.disconnect();await audioContext?.close();}catch{}
  socket=stream=audioContext=null;captureStreams=[];sourceNodes=[];workletNode=null;clearInterval(timerHandle);$('start').innerHTML=startButtonContent;$('start').classList.remove('stop');setControls(false);setMicStatus(`已確認：${$('activeMic').textContent}`,'ok');setStatus(transcript?'會議已結束':'系統待機');scheduleTranslation(true);stopping=false;
}
function updateTimer(){const sec=Math.floor((Date.now()-startedAt)/1000);$('timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function onMessage(event){
  let data; try{data=JSON.parse(event.data)}catch{return}
  if(data.status==='error'){setStatus(typeof data.msg==='string'?data.msg:'辨識服務錯誤','error');return}
  const chunk=data.msg?.text||'';
  if(!chunk){if(data.msg?.reset&&transcript.length>translationOffset)scheduleTranslation(true);return}
  transcript = typeof data.displayText==='string' ? data.displayText : transcript+chunk;
  render('transcript',transcript); scheduleTranslation(Boolean(data.msg?.reset));
}
function sentenceBoundary(start=translationOffset){
  const pending=transcript.slice(start);
  const match=/[。！？.!?；;]+[」』】）》〉）\]”’"']*/u.exec(pending);
  return match?start+match.index+match[0].length:0;
}
function scheduleTranslation(force=false){
  if(transcript.length<=translationOffset)return;
  clearTimeout(pauseTimer);
  if(force)flushRequested=true;
  const boundary=sentenceBoundary();
  if(boundary||force){
    activeTranslation?.kind==='draft'&&activeTranslation.abort();
    clearTimeout(translationTimer);translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},boundary?90:0);
    return;
  }
  // A fixed cadence, not a debounce: continuous ASR updates must never postpone the first draft.
  if(!activeTranslation&&!translationTimer&&transcript.length-translationOffset>=6)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},250);
  pauseTimer=setTimeout(()=>{pauseTimer=null;flushRequested=true;activeTranslation?.kind==='draft'&&activeTranslation.abort();runTranslation()},1800);
}
async function streamTranslation(body,signal){
  const response=await fetch('/api/translate/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok)throw new Error((await response.json()).detail||'翻譯失敗');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result='';
  while(true){
    const {value,done}=await reader.read();if(done)break;
    buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
    let end;while((end=buffer.indexOf('\n\n'))>=0){
      const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
      for(const line of event.split('\n')){if(!line.startsWith('data: '))continue;const data=JSON.parse(line.slice(6));if(data.error)throw new Error(data.error);if(typeof data.text==='string')result=data.text}
    }
  }
  if(!result.trim())throw new Error('翻譯服務沒有回傳內容');
  return result.trim();
}
async function runTranslation(){
  if(activeTranslation||transcript.length<=translationOffset)return;
  const boundary=sentenceBoundary(),pending=transcript.slice(translationOffset),tooLong=pending.length>=220;
  const split=tooLong?pending.lastIndexOf(' ',220):-1;
  const segmentEnd=boundary&&boundary<=translationOffset+220?boundary:(tooLong?translationOffset+(split>=120?split+1:220):transcript.length);
  const final=Boolean(boundary||flushRequested||tooLong);
  const segment=transcript.slice(translationOffset,segmentEnd).trim();
  if(!segment)return;
  const minGrowth=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment)?6:12;
  if(!final&&lastDraftSource&&segment.startsWith(lastDraftSource)&&segment.length-lastDraftSource.length<minGrowth)return;
  const epoch=translationEpoch,controller=new AbortController();controller.kind=final?'final':'draft';activeTranslation=controller;
  if(final)flushRequested=false;else lastDraftSource=segment;
  $('translateState').textContent=final?'修訂中':'暫譯中';$('translateState').className='state-chip active';
  let mayContinue=false;
  try{
    // Keep the previous readable draft visible while translation generates the next hypothesis.
    // Token-by-token replacement made the card collapse and jump on every request.
    const next=await streamTranslation({text:segment,source:direction.source,target:direction.target,history:final?translationHistory.slice(-2).map(item=>item.source).join(' / '):'',draft:!final},controller.signal);
    if(epoch!==translationEpoch||activeTranslation!==controller)return;
    if(final){translated+=translated?'\n'+next:next;translationOffset=segmentEnd;translationHistory.push({source:segment,target:next});draftText='';lastDraftSource='';clearTimeout(pauseTimer);renderTranslation();$('translateState').textContent='LIVE'}
    else{draftText=next;renderTranslation();$('translateState').textContent='暫譯'}
    mayContinue=true;
  }catch(error){
    mayContinue=error.name==='AbortError';
    if(error.name!=='AbortError'&&epoch===translationEpoch){$('translateState').textContent='OFFLINE';$('translateState').className='state-chip error';toast(error.message)}
  }finally{
    if(activeTranslation===controller)activeTranslation=null;
    if(mayContinue&&epoch===translationEpoch&&transcript.length>translationOffset){
      if(final&& !controller.signal.aborted)scheduleTranslation(false);
      else if(sentenceBoundary()||flushRequested)runTranslation();
      else if(transcript.slice(translationOffset).trim()!==lastDraftSource&&!translationTimer)translationTimer=setTimeout(()=>{translationTimer=null;runTranslation()},650);
    }
  }
}
$('start').onclick=()=>stream?stopMeeting():startMeeting();
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
$('download').onclick=()=>{const blob=new Blob([`原文\n${transcript}\n\n翻譯\n${visibleTranslation()}\n`],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`meeting-${new Date().toISOString().slice(0,19).replaceAll(':','-')}.txt`;a.click();URL.revokeObjectURL(a.href)};
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const value=button.dataset.copy==='transcript'?transcript:visibleTranslation();if(!value)return toast('目前沒有可複製的內容');await navigator.clipboard.writeText(value);toast('已複製到剪貼簿')});
