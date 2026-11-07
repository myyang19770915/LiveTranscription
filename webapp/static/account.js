// Signed-in user in the nav (#account), shared by every page. Exposes window.accountReady (the /api/me payload)
// and window.AvatarPhoto (member-avatars, avatar-self-service, avatar-crop): after an image is chosen, a crop dialog
// shows it with a square frame the user moves and resizes; only on 確定 is the framed area scaled to 160x160 and
// uploaded. The header avatar opens a menu to change one's own photo; a change is announced with a `yq:avatar` event
// so pages showing avatars can reload them. The dialog's styles are injected here once, because the live meeting
// page (themes.css) and the other pages (tokens.css) have different stylesheets; colours fall back between the two.
window.AvatarPhoto=(()=>{
  const SIZE=160,PREVIEW=64;
  const make=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(Boolean));return node};
  const clamp=(value,low,high)=>Math.min(Math.max(value,low),high);
  const CSS=`
.crop-dialog{width:max-content;max-width:calc(100vw - 32px);padding:20px;border:1px solid var(--border,var(--line));border-radius:16px;
  background:var(--panel,var(--surface));color:var(--text);box-shadow:0 24px 64px rgb(0 0 0/.35)}
.crop-dialog::backdrop{background:rgb(0 0 0/.55)}
.crop-dialog h2{margin:0;font-size:18px}
.crop-hint{margin:4px 0 14px;color:var(--muted);font-size:13px}
.crop-body{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:center}
.crop-stage{position:relative;overflow:hidden;touch-action:none;user-select:none;border-radius:8px;background:#000}
.crop-stage canvas{display:block}
.crop-frame{position:absolute;box-sizing:border-box;border:2px solid #fff;box-shadow:0 0 0 9999px rgb(0 0 0/.55);cursor:move}
.crop-frame::after{content:"";position:absolute;inset:0;border:1px dashed rgb(255 255 255/.75);border-radius:50%;pointer-events:none}
.crop-frame:focus-visible{outline:3px solid var(--accent,var(--mint));outline-offset:2px}
.crop-handle{position:absolute;right:-2px;bottom:-2px;width:18px;height:18px;border-radius:4px 0 4px 0;background:#fff;cursor:nwse-resize}
.crop-side{display:grid;justify-items:center;gap:8px;color:var(--muted);font-size:12px}
.crop-preview{width:${PREVIEW}px;height:${PREVIEW}px;border-radius:50%;background:var(--field,var(--soft))}
.crop-size{width:100%;accent-color:var(--accent,var(--mint))}
.crop-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.crop-actions button{height:38px;padding:0 18px;border:1px solid var(--border,var(--line));border-radius:999px;background:transparent;
  color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.crop-actions .crop-ok{border-color:transparent;background:var(--accent,var(--mint));color:var(--accent-ink,#06110d)}`;
  function bitmapOf(file){
    if(!file.type.startsWith('image/')||file.type==='image/svg+xml')return Promise.reject(new Error('請選 PNG、JPEG 或 WebP 圖片'));
    return createImageBitmap(file).catch(()=>{throw new Error('讀不到這張圖片，請換一張')});
  }
  // The crop dialog: resolves to the source rectangle {x, y, size} in image pixels, or null when cancelled.
  function frameOn(bitmap){
    if(!document.getElementById('crop-style'))document.head.append(make('style',{id:'crop-style',textContent:CSS}));
    const {width,height}=bitmap;
    const longest=Math.max(120,Math.min(360,innerWidth-80));
    const scale=Math.min(longest/width,longest/height);
    const w=Math.round(width*scale),h=Math.round(height*scale);
    const full=Math.min(w,h),least=Math.max(24,Math.round(full*.2));
    const frame={size:full,x:(w-full)/2,y:(h-full)/2};
    const ratio=1/scale;
    const source=()=>({x:frame.x*ratio,y:frame.y*ratio,size:frame.size*ratio});

    const dpr=devicePixelRatio||1;
    const picture=make('canvas',{width:Math.round(w*dpr),height:Math.round(h*dpr)});
    Object.assign(picture.style,{width:`${w}px`,height:`${h}px`});
    picture.getContext('2d').drawImage(bitmap,0,0,picture.width,picture.height);
    const handle=make('span',{className:'crop-handle',title:'拖曳調整大小'});
    const box=make('div',{className:'crop-frame',tabIndex:0,ariaLabel:'裁切範圍，方向鍵移動'},handle);
    const stage=make('div',{className:'crop-stage'},picture,box);
    Object.assign(stage.style,{width:`${w}px`,height:`${h}px`});
    const preview=make('canvas',{className:'crop-preview',width:PREVIEW*dpr,height:PREVIEW*dpr,ariaLabel:'預覽'});
    const slider=make('input',{type:'range',className:'crop-size',min:least,max:full,step:1,value:full,ariaLabel:'框選大小'});
    const cancel=make('button',{type:'button',textContent:'取消'});
    const ok=make('button',{type:'button',className:'crop-ok',textContent:'確定'});
    const dialog=make('dialog',{className:'crop-dialog',ariaLabel:'裁切照片'},
      make('h2',{textContent:'裁切照片'}),
      make('p',{className:'crop-hint',textContent:'拖曳方框選擇範圍，拉右下角或用滑桿調整大小；也可用方向鍵移動、＋／－ 縮放。'}),
      make('div',{className:'crop-body'},stage,make('div',{className:'crop-side'},preview,make('span',{textContent:'預覽'}),slider)),
      make('div',{className:'crop-actions'},cancel,ok));

    function draw(){
      frame.size=clamp(frame.size,least,full);
      frame.x=clamp(frame.x,0,w-frame.size);frame.y=clamp(frame.y,0,h-frame.size);
      Object.assign(box.style,{left:`${frame.x}px`,top:`${frame.y}px`,width:`${frame.size}px`,height:`${frame.size}px`});
      slider.value=Math.round(frame.size);
      const r=source();
      const g=preview.getContext('2d');
      g.clearRect(0,0,preview.width,preview.height);   // transparent images must not keep earlier positions
      g.drawImage(bitmap,r.x,r.y,r.size,r.size,0,0,preview.width,preview.height);
    }
    // Drag the frame to move it, its handle to resize it (top-left corner fixed).
    box.onpointerdown=event=>{
      event.preventDefault();box.focus();
      const resizing=event.target===handle,start={px:event.clientX,py:event.clientY,...frame};
      box.setPointerCapture(event.pointerId);
      box.onpointermove=move=>{
        const dx=move.clientX-start.px,dy=move.clientY-start.py;
        if(resizing)frame.size=clamp(start.size+Math.max(dx,dy),least,Math.min(w-start.x,h-start.y));
        else{frame.x=start.x+dx;frame.y=start.y+dy}
        draw();
      };
      box.onpointerup=box.onpointercancel=()=>{box.onpointermove=null};
    };
    // Resize about the frame's centre; the size is clamped first so a frame at its limit does not drift.
    const resize=size=>{
      const next=clamp(size,least,full),cx=frame.x+frame.size/2,cy=frame.y+frame.size/2;
      Object.assign(frame,{size:next,x:cx-next/2,y:cy-next/2});draw();
    };
    // Arrow keys move (Shift: further); + and - resize.
    box.onkeydown=event=>{
      const step=event.shiftKey?20:4;
      const moves={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
      if(moves[event.key]){frame.x+=moves[event.key][0];frame.y+=moves[event.key][1];draw()}
      else if(event.key==='+'||event.key==='=')resize(frame.size+step);
      else if(event.key==='-')resize(frame.size-step);
      else return;
      event.preventDefault();
    };
    slider.oninput=()=>resize(Number(slider.value));
    return new Promise(resolve=>{
      let result=null;
      ok.onclick=()=>{result=source();dialog.close()};
      cancel.onclick=()=>dialog.close();
      dialog.onclose=()=>{dialog.remove();resolve(result)};
      // Keys belong to the dialog: the page's own shortcuts (Space plays audio, Esc closes a side panel) must not
      // react behind it. Esc still cancels, the browser closes a modal dialog by itself.
      dialog.addEventListener('keydown',event=>event.stopPropagation());
      document.body.append(dialog);
      draw();dialog.showModal();box.focus();
    });
  }
  // Ask the user for the area to keep; resolves to a 160x160 WebP (JPEG where WebP cannot be encoded), or null.
  async function crop(file){
    const bitmap=await bitmapOf(file);
    try{
      const area=await frameOn(bitmap);
      if(!area)return null;
      const canvas=make('canvas',{width:SIZE,height:SIZE});
      canvas.getContext('2d').drawImage(bitmap,area.x,area.y,area.size,area.size,0,0,SIZE,SIZE);
      const encode=type=>new Promise(resolve=>canvas.toBlob(resolve,type,.85));
      const webp=await encode('image/webp');
      return webp?.type==='image/webp'?webp:encode('image/jpeg');
    }finally{bitmap.close()}
  }
  async function failed(response,fallback){
    const detail=(await response.json().catch(()=>({}))).detail;
    return new Error(typeof detail==='string'?detail:fallback);
  }
  // Crop, then PUT the photo to url (the administrator API or /api/me/avatar); resolves to {username, avatarUrl},
  // or null when the user cancelled the crop (nothing is sent).
  async function upload(url,file){
    const photo=await crop(file);
    if(!photo)return null;
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
  return {crop,upload,remove,pick,initial};
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
      location.pathname!=='/metrics'?link('/metrics','成效指標'):null,
      me.admin&&location.pathname!=='/admin'?link('/admin','團隊管理'):null].filter(Boolean);
    // Search (meeting-search): an icon, shown on phones too; / opens it from any page.
    const search=location.pathname==='/search'?null:Object.assign(make('a',{href:'/search',className:'account-search',title:'搜尋（/）',ariaLabel:'搜尋'}),
      {innerHTML:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>'});
    slot.replaceChildren(...[search,...links,ownAvatar(me,make),name,out].filter(Boolean));
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
        close();   // the crop dialog takes over; an error reopens the menu with its message
        const result=await AvatarPhoto.upload('/api/me/avatar',file);
        if(result)changed(result.avatarUrl);   // null: the crop was cancelled, nothing changed
        close();
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

// "/" opens search from any page (meeting-search), unless typing or a dialog is open; on the search page it focuses the box.
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented)return;
  if(event.target.closest?.('input, textarea, select, [contenteditable="true"]')||document.querySelector('dialog[open]'))return;
  event.preventDefault();
  const box=location.pathname==='/search'&&document.getElementById('q');
  if(box){box.focus();box.select()}else location.href='/search';
});
