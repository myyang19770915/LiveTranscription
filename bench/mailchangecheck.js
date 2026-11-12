// minutes.js mailChangeLine(): who last changed the team's mail settings (mail-settings-audit).
// node bench/mailchangecheck.js; exits 1 on any FAIL.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../webapp/static/minutes.js'),'utf8');
const pick=(start,end)=>{const i=src.indexOf(start),j=src.indexOf(end,i+start.length);if(i<0||j<0)throw new Error(`${start} not found in minutes.js`);return src.slice(i,j)};
const when=pick('const when=','\n');
const line=pick('function mailChangeLine(','\nfunction renderMail(');
const mailChangeLine=new Function(`${when}\n${line}\nreturn mailChangeLine;`)();
let failed=0;
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);if(!ok)failed++;console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${JSON.stringify(got)}`)};
const at='2026-11-12T14:03:00+08:00';
const stamp=new Date(at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
t('no change yet',mailChangeLine(null),null);
t('a member changes the settings',mailChangeLine({at,by:'王愛麗',member:true,target:'team',address:'rd@corp.example',auto:false}),
  [`寄送設定由 王愛麗 於 ${stamp} 修改`,'']);
t('an administrator who is not a member',mailChangeLine({at,by:'管理員',member:false,target:'team',address:'someone@outside.example',auto:false}),
  [`寄送設定由 管理員（系統管理員，非團隊成員）於 ${stamp} 修改：改寄團隊信箱 someone@outside.example`,'warn']);
t('… with automatic sending on',mailChangeLine({at,by:'管理員',member:false,target:'members',address:'',auto:true}),
  [`寄送設定由 管理員（系統管理員，非團隊成員）於 ${stamp} 修改：改寄給成員的個人信箱，定稿後自動寄送`,'warn']);
t('spec example row 3: team address and automatic sending',mailChangeLine({at,by:'管理員',member:false,target:'team',address:'someone@outside.example',auto:true}),
  [`寄送設定由 管理員（系統管理員，非團隊成員）於 ${stamp} 修改：改寄團隊信箱 someone@outside.example，定稿後自動寄送`,'warn']);
if(failed)process.exitCode=1;
