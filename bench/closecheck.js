// app.js closeMessage(): the live page shows the server's reason for stream-limit closes (stream-limits).
// node bench/closecheck.js; exits 1 on any FAIL.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../webapp/static/app.js'),'utf8');
const start=src.indexOf('function closeMessage('),end=src.indexOf('\nfunction ',start+10);
if(start<0||end<0)throw new Error('closeMessage() not found in app.js');
const closeMessage=new Function(`${src.slice(start,end)}\nreturn closeMessage;`)();
let failed=0;
const t=(name,got,want)=>{const ok=got===want;if(!ok)failed++;console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${got}`)};
t('4429 too many streams',closeMessage(4429,'同時進行的辨識已達上限（2 條）'),'同時進行的辨識已達上限（2 條）');
t('4413 length limit',closeMessage(4413,'已達單場上限 4 小時，錄音已停止'),'已達單場上限 4 小時，錄音已停止');
t('4408 no start message',closeMessage(4408,'沒有收到開始訊息，連線已關閉'),'沒有收到開始訊息，連線已關閉');
t('4403 removed from the team',closeMessage(4403,'你已不是這個團隊的成員，錄音已停止'),'你已不是這個團隊的成員，錄音已停止');
t('4404 meeting not found',closeMessage(4404,'meeting not found'),'找不到這場會議，請重新整理後再試');
t('4401 mid-meeting',closeMessage(4401,'session ended'),'登入已失效，錄音已停止；請先下載錄音，再重新登入');
t('other codes',closeMessage(1006,''),'辨識連線已中斷');
t('limit code without a reason',closeMessage(4429,''),'辨識連線已中斷');
// onSocketClose(): 4401 during a meeting stops it first (the recording stays downloadable); without one, sign in.
const handlerStart=src.indexOf('function onSocketClose('),handlerEnd=src.indexOf('\n// Why the server closed',handlerStart);
if(handlerStart<0||handlerEnd<0)throw new Error('onSocketClose() not found in app.js');
(async()=>{
  for(const [running,code,wantStop,wantLogin] of [[true,4401,true,false],[false,4401,false,true],[true,4429,true,false],[false,1006,false,false]]){
    const env={stream:running?{}:null,stopping:false,stopped:0,status:null,went:null,closeMessage,
      stopMeeting:async()=>{env.stopped++},setStatus:(text,kind)=>{env.status=[text,kind]},location:{replace:url=>{env.went=url}}};
    const onSocketClose=new Function('env',`with(env){${src.slice(handlerStart,handlerEnd)}\nreturn onSocketClose;}`)(env);
    await onSocketClose({code,reason:''});
    t(`close ${code} ${running?'during':'without'} a meeting: stops it`,env.stopped===1,wantStop);
    t(`close ${code} ${running?'during':'without'} a meeting: goes to sign-in`,env.went==='/login',wantLogin);
    if(running&&code===4401)t('4401 during a meeting: says why',env.status?.join(' / '),'登入已失效，錄音已停止；請先下載錄音，再重新登入 / error');
  }
  if(failed)process.exitCode=1;
})();
