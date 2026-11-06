// Signed-in user in the nav (#account), shared by every page. Exposes window.accountReady (the /api/me payload)
// and window.AvatarPhoto (member-avatars, avatar-self-service): the browser crops the chosen image to its centre
// square and scales it to 160x160 before uploading. The header avatar opens a menu to change one's own photo; a
// change is announced with a `yq:avatar` event so pages showing avatars can reload them.
window.AvatarPhoto=(()=>{
  const SIZE=160;
  async function square(file){
    if(!file.type.startsWith('image/')||file.type==='image/svg+xml')throw new Error('請選 PNG、JPEG 或 WebP 圖片');
    let bitmap;
    try{bitmap=await createImageBitmap(file)}catch{throw new Error('讀不到這張圖片，請換一張')}
    const side=Math.min(bitmap.width,bitmap.height);
    const canvas=Object.assign(document.createElement('canvas'),{width:SIZE,height:SIZE});
    canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,SIZE,SIZE);
    bitmap.close();
    const encode=type=>new Promise(resolve=>canvas.toBlob(resolve,type,.85));
    const webp=await encode('image/webp');
    return webp?.type==='image/webp'?webp:encode('image/jpeg');
  }
  async function failed(response,fallback){
    const detail=(await response.json().catch(()=>({}))).detail;
    return new Error(typeof detail==='string'?detail:fallback);
  }
  // PUT the cropped photo to url (the administrator API or /api/me/avatar); resolves to {username, avatarUrl}.
  async function upload(url,file){
    const photo=await square(file);
    const response=await fetch(url,{method:'PUT',headers:{'content-type':photo.type},body:photo});
    if(!response.ok)throw await failed(response,'照片上傳失敗，請再試一次');
    return response.json();
  }
  async function remove(url){
    const response=await fetch(url,{method:'DELETE'});
    if(!response.ok)throw await failed(response,'移除照片失敗，請再試一次');
  }
  // Ask for one image file; resolves to the file, or null when the picker is closed without one.
  function pick(){
    return new Promise(resolve=>{
      const input=Object.assign(document.createElement('input'),{type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true});
      const done=file=>{input.remove();resolve(file)};
      input.onchange=()=>done(input.files[0]||null);
      input.oncancel=()=>done(null);
      document.body.append(input);
      input.click();
    });
  }
  const initial=(name,username)=>[...(name||username||'?')][0].toUpperCase();
  return {square,upload,remove,pick,initial};
})();

window.accountReady=fetch('/api/me').then(response=>{
  if(response.status===401){location.replace('/login');return new Promise(()=>{})}
  return response.json();
}).then(me=>{
  const slot=document.getElementById('account');
  if(slot){
    const make=(tag,props)=>Object.assign(document.createElement(tag),props);
    const name=make('span',{className:'account-name'});
    name.append(make('b',{textContent:me.displayName||me.username}));
    const out=make('button',{type:'button',textContent:'登出',onclick:async()=>{await fetch('/api/logout',{method:'POST'});location.replace('/login')}});
    const link=(href,text)=>make('a',{href,textContent:text});
    const links=[location.pathname==='/'?link('/meetings','會議紀錄'):null,location.pathname!=='/actions'?link('/actions','待辦看板'):null,
      me.admin&&location.pathname!=='/admin'?link('/admin','團隊管理'):null].filter(Boolean);
    slot.replaceChildren(...links,ownAvatar(me,make),name,out);
  }
  return me;
});

// The header avatar and its menu: 更換照片, and 移除照片 when there is a photo.
function ownAvatar(me,make){
  const wrap=make('span',{className:'account-me'});
  const button=make('button',{type:'button',className:'account-avatar',title:'更換我的照片',ariaLabel:'我的照片'});
  button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
  const menu=make('div',{className:'account-menu',hidden:true});
  menu.setAttribute('role','menu');
  const message=make('p',{className:'account-menu-error',hidden:true});
  const face=()=>{
    const letter=()=>make('span',{className:'account-initial',textContent:AvatarPhoto.initial(me.displayName,me.username)});
    if(!me.avatarUrl)return letter();
    const img=make('img',{src:me.avatarUrl,alt:'',width:28,height:28});
    img.onerror=()=>img.replaceWith(letter());
    return img;
  };
  const open=()=>{
    menu.hidden=false;button.setAttribute('aria-expanded','true');
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  };
  const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
  const outside=event=>{if(!wrap.contains(event.target))close()};
  const escape=event=>{if(event.key==='Escape'){close();button.focus()}};
  const show=avatarUrl=>{me.avatarUrl=avatarUrl;button.replaceChildren(face());render()};
  const changed=avatarUrl=>{
    show(avatarUrl);
    window.dispatchEvent(new CustomEvent('yq:avatar',{detail:{username:me.username,avatarUrl}}));
  };
  // Another part of the page changed this user's photo (an administrator's own row on the team page).
  window.addEventListener('yq:avatar-own',event=>show(event.detail.avatarUrl));
  const run=async work=>{
    message.hidden=true;
    try{await work()}catch(error){message.textContent=error.message;message.hidden=false;open()}
  };
  const item=(text,onclick)=>{const node=make('button',{type:'button',textContent:text,onclick});node.setAttribute('role','menuitem');return node};
  function render(){
    menu.replaceChildren(...[
      item('更換照片',()=>run(async()=>{
        const file=await AvatarPhoto.pick();
        if(!file)return;
        const result=await AvatarPhoto.upload('/api/me/avatar',file);
        changed(result.avatarUrl);close();
      })),
      me.avatarUrl?item('移除照片',()=>run(async()=>{await AvatarPhoto.remove('/api/me/avatar');changed(null);close()})):null,
      message].filter(Boolean));
  }
  render();
  button.append(face());
  button.onclick=()=>{
    if(!menu.hidden){close();return}
    message.hidden=true;open();
    menu.querySelector('button')?.focus();
  };
  wrap.append(button,menu);
  return wrap;
}
