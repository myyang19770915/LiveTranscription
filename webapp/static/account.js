// Signed-in user in the nav (#account), shared by every page. Exposes window.accountReady (the /api/me payload).
window.accountReady=fetch('/api/me').then(response=>{
  if(response.status===401){location.replace('/login');return new Promise(()=>{})}
  return response.json();
}).then(me=>{
  const slot=document.getElementById('account');
  if(slot){
    const name=Object.assign(document.createElement('span'),{className:'account-name'});
    name.append(Object.assign(document.createElement('b'),{textContent:me.displayName||me.username}));
    const out=Object.assign(document.createElement('button'),{type:'button',textContent:'登出',onclick:async()=>{await fetch('/api/logout',{method:'POST'});location.replace('/login')}});
    const link=(href,text)=>Object.assign(document.createElement('a'),{href,textContent:text});
    const links=[location.pathname==='/'?link('/meetings','會議紀錄'):null,location.pathname!=='/actions'?link('/actions','待辦看板'):null,
      me.admin&&location.pathname!=='/admin'?link('/admin','團隊管理'):null].filter(Boolean);
    slot.replaceChildren(...links,name,out);
  }
  return me;
});
