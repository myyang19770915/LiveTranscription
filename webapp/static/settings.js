// System settings page (system-settings): the settings that apply to everyone, one row each.
//   紀錄保存期限: how many days saved 即時翻譯 / 即時口譯 records are kept (realtime-interpret).
//   即時口譯權限: the accounts that may interpret besides system administrators (interpret-mode-on-home).
const $=id=>document.getElementById(id);
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(child=>child!=null));return node}
function showError(message){$('settingsError').textContent=message;$('settingsError').hidden=!message}
async function call(method,url,body){
  const response=await fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  if(!response.ok){const detail=(await response.json().catch(()=>({}))).detail;throw new Error(typeof detail==='string'?detail:'操作失敗，請再試一次')}
  return response.status===204?null:response.json();
}
async function act(work,button){showError('');if(button)button.disabled=true;try{await work()}catch(error){showError(error.message)}finally{if(button)button.disabled=false}}
// A button that asks once more ("確定…？") before doing its work; the question goes away after 4 s.
function confirmButton(label,question,work){
  const button=el('button',{type:'button',className:'text-button danger',textContent:label});
  button.onclick=()=>{
    if(button.dataset.confirm){act(work,button);return}
    button.dataset.confirm='1';button.textContent=question;
    setTimeout(()=>{if(button.isConnected){delete button.dataset.confirm;button.textContent=label}},4000);
  };
  return button;
}

async function loadAccess(){
  const granted=await call('GET','/api/admin/interpret-access');
  $('accessList').replaceChildren(...(granted.length?granted.map(g=>el('li',{className:'member'},
    el('span',{className:'member-text'},el('b',{textContent:g.username}),el('small',{textContent:`由 ${g.grantedBy} 開放`})),
    el('span',{className:'member-actions'},confirmButton('移除',`確定移除 ${g.username} 的即時口譯權限？`,async()=>{await call('DELETE',`/api/admin/interpret-access/${encodeURIComponent(g.username)}`);await loadAccess()}))))
    :[el('li',{className:'empty-members',textContent:'還沒有開放給任何人。'})]));
}
$('accessForm').onsubmit=event=>{event.preventDefault();const name=$('accessName').value.trim();if(!name)return;
  act(async()=>{await call('POST','/api/admin/interpret-access',{username:name});$('accessName').value='';await loadAccess()},event.submitter)};

const loadRetention=()=>call('GET','/api/admin/records-retention').then(r=>{$('retentionDays').value=r.days});
$('retentionForm').onsubmit=event=>{event.preventDefault();const days=Number($('retentionDays').value);
  act(async()=>{const r=await call('PUT','/api/admin/records-retention',{days});$('retentionDays').value=r.days;$('retentionNote').textContent=`已儲存：保存 ${r.days} 天，較舊的紀錄已刪除。`},event.submitter)};

$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('interpreter-theme',next)}catch{}};
const load=()=>Promise.all([loadRetention(),loadAccess()]).catch(error=>showError(error.message));
window.onPageShown(load);   // shown after being prepared (page-switching)
load();
